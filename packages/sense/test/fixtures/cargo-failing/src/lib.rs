pub fn half(a: i32) -> i32 {
    a / 2
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn halves() {
        assert_eq!(half(4), 2);
    }

    #[test]
    fn rounds_up() {
        assert_eq!(half(3), 2, "half rounds down");
    }
}
