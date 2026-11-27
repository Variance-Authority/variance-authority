use super::*;

const CALC: &str = "LIMIT = 3

def add(a, b):
    return a + b

class Calc:
    scale = 2

    def twice(self, x):
        def inner(y):
            return y * 2
        return inner(x)

    @staticmethod
    async def later():
        return 1

f = lambda x: add(x, x)
";


fn lines(file: &std::path::Path, numbers: &[u32]) -> PythonLines {
    PythonLines { file: file.to_string_lossy().into_owned(), lines: Uint32Array::new(numbers.to_vec()) }
}

// A test is charged the functions its lines are in, and the root of any file it entered; a file outside the root is not the checkout's.
#[test]
fn a_test_is_charged_the_functions_its_lines_ran() {
    let root = std::env::temp_dir().join(format!("variance-python-coverage-{}", std::process::id()));
    std::fs::create_dir_all(&root).expect("a scratch directory");
    let source = "def add(a, b):\n    return a + b\n\ndef sub(a, b):\n    return a - b\n";
    std::fs::write(root.join("calc.py"), source).expect("the file is written");
    std::fs::write(root.join("broken.py"), "def a(:\n").expect("the file is written");
    let file = root.join("calc.py");
    let broken = root.join("broken.py");
    let outside = std::env::temp_dir().join("elsewhere.py");
    let cases = vec![
        vec![lines(&file, &[1, 2])],
        vec![lines(&file, &[4, 5])],
        vec![lines(&broken, &[1]), lines(&outside, &[1])],
        vec![lines(&file, &[3])],
    ];
    let entered = python_coverage(cases, root.to_string_lossy().into_owned());
    std::fs::remove_dir_all(&root).ok();
    let id = variance_sense_instrument::module_id("calc.py", source);
    let seen: Vec<Vec<(String, Vec<u32>)>> =
        entered.into_iter().map(|case| case.into_iter().map(|file| (file.id, file.ordinals.to_vec())).collect()).collect();
    assert_eq!(seen[0], vec![(id.clone(), vec![0, 1])]);
    assert_eq!(seen[1], vec![(id, vec![0, 2])]);
    assert_eq!(seen[2].len(), 1);
    assert_eq!(seen[2][0].1, vec![0]);
    assert!(seen[3].is_empty() || seen[3][0].1 == vec![0]);
}

// Lines are 1-based; the innermost function around one is charged, and the module body when none is.
#[test]
fn a_line_is_charged_to_the_innermost_function_around_it() {
    let out = cut(CALC).expect("parses");
    let lines = Lines::new(CALC.to_owned());
    let at = |n: usize| lines.charged(&out, n);
    assert_eq!(at(1), Some(0));
    assert_eq!(at(4), Some(1));
    assert_eq!(at(11), Some(3));
    assert_eq!(at(12), Some(2));
    assert_eq!(at(7), Some(0));
    assert_eq!(at(99), None);
}
