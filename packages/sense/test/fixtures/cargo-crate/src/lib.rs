pub fn add(a: i32, b: i32) -> i32 { a + b }

pub fn mul(a: i32, b: i32) -> i32 {
    let mut r = 0;
    for _ in 0..b { r = add(r, a); }
    r
}

pub fn neg(a: i32) -> i32 {
    if a > 0 { -a } else { a.abs() * -1 * -1 * -1 }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn adds() { assert_eq!(add(2, 3), 5); }
    #[test] fn muls() { assert_eq!(mul(2, 3), 6); }
    #[test] fn negs() { assert_eq!(neg(2), -2); }
}
