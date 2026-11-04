module BinaryExponentiation (power) where

-- | @power x n@ computes x^n with O(log n) multiplications
-- by repeated squaring.
power :: Num a => a -> Integer -> a
#ifdef TEMPLATE
power x n = undefined
#else
power _ 0 = 1
power x n
  | even n    = let h = power x (n `div` 2) in h * h
  | otherwise = x * power x (n - 1)
#endif
