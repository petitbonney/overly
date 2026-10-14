//! Restart delays for the sidecar: doubling from `initial`, capped at `max`.

use std::time::Duration;

pub const DEFAULT_INITIAL: Duration = Duration::from_millis(500);
pub const DEFAULT_MAX: Duration = Duration::from_secs(30);

#[derive(Debug, Clone)]
pub struct Backoff {
    initial: Duration,
    max: Duration,
    attempt: u32,
}

impl Backoff {
    pub fn new(initial: Duration, max: Duration) -> Self {
        Self {
            initial,
            max,
            attempt: 0,
        }
    }

    /// The delay before the next restart. Also counts the attempt.
    pub fn next_delay(&mut self) -> Duration {
        let factor = 2u32.saturating_pow(self.attempt);
        self.attempt = self.attempt.saturating_add(1);
        self.initial.saturating_mul(factor).min(self.max)
    }

    /// How many delays were handed out since the last reset.
    pub fn attempt(&self) -> u32 {
        self.attempt
    }

    pub fn reset(&mut self) {
        self.attempt = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn millis(backoff: &mut Backoff, count: usize) -> Vec<u128> {
        (0..count)
            .map(|_| backoff.next_delay().as_millis())
            .collect()
    }

    #[test]
    fn backoff_doubles_up_to_the_cap() {
        let mut backoff = Backoff::new(DEFAULT_INITIAL, DEFAULT_MAX);
        assert_eq!(
            millis(&mut backoff, 8),
            [500, 1000, 2000, 4000, 8000, 16000, 30000, 30000]
        );
        assert_eq!(backoff.attempt(), 8);
        // Far past the cap, no overflow.
        assert_eq!(millis(&mut backoff, 40).last(), Some(&30000));
    }

    #[test]
    fn backoff_reset_starts_over() {
        let mut backoff = Backoff::new(DEFAULT_INITIAL, DEFAULT_MAX);
        millis(&mut backoff, 3);
        backoff.reset();
        assert_eq!(backoff.attempt(), 0);
        assert_eq!(backoff.next_delay(), DEFAULT_INITIAL);
        assert_eq!(backoff.attempt(), 1);
    }
}
