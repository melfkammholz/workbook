module Gcd (gcd, primeFactors, gcdPF) where

import Prelude hiding (gcd)

-- | The greatest common divisor, by Euclid's algorithm.
gcd :: Integral a => a -> a -> a
#ifdef TEMPLATE
gcd x y = undefined
#else
gcd x 0 = abs x
gcd x y = gcd y (x `mod` y)
#endif

-- | The prime factors of a number, with multiplicity, in ascending order.
--
-- >>> primeFactors 12
-- [2,2,3]
primeFactors :: Integer -> [Integer]
#ifdef TEMPLATE
primeFactors n = undefined
#else
primeFactors = go 2
  where
    go p m
      | m < 2          = []
      | p * p > m      = [m]
      | m `mod` p == 0 = p : go p (m `div` p)
      | otherwise      = go (p + 1) m
#endif

-- | The greatest common divisor of two positive numbers, computed as the
-- product of the intersection of their prime factors.
gcdPF :: Integer -> Integer -> Integer
#ifdef TEMPLATE
gcdPF x y = undefined
#else
gcdPF x y = product (common (primeFactors x) (primeFactors y))
  where
    common (a : as) (b : bs)
      | a == b    = a : common as bs
      | a < b     = common as (b : bs)
      | otherwise = common (a : as) bs
    common _ _ = []
#endif
