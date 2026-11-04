module Playground.AutomaticDifferentiation (d1, d2) where


-- | A type for automatic differentiation. It holds a value and a derivative.
-- Conceptually, a value of type @D a@ has shape @D f(x) f'(x)@.
data D a = D a a
  deriving (Eq, Ord, Show)

-- | Computes the first-order derivative of a function.
d1 :: Num a => (D a -> D b) -> a -> b
d1 f x = let (D _ d) = f (D x 1) in d

-- | Computes the second-order derivative of a function.
d2 :: Num a => (D (D a) -> D (D b)) -> a -> b
d2 f x = let (D (D _ _) (D _ d)) = f (D (D x 1) 1) in d


instance Num a => Num (D a) where
#ifdef TEMPLATE
#else
  D x1 d1 + D x2 d2 = D (x1 + x2) (d1 + d2)
  D x1 d1 - D x2 d2 = D (x1 - x2) (d1 - d2)
  D x1 d1 * D x2 d2 = D (x1 * x2) (d1 * x2 + x1 * d2)
  negate (D x d)    = D (negate x) (negate d)
  abs (D x d)       = D (abs x) (d * signum x)
  signum (D x d)    = D (signum x) 0
  fromInteger x     = D (fromInteger x) 0
#endif

instance Fractional a => Fractional (D a) where
#ifdef TEMPLATE
#else
  D x1 d1 / D x2 d2 = D (x1 / x2) ((d1 * x2 - x1 * d2) / (x2 * x2))
  fromRational r    = D (fromRational r) 0
#endif

instance Floating a => Floating (D a) where
#ifdef TEMPLATE
#else
  pi = D pi 0
  exp (D x d)   = D (exp x)   (d * exp x)
  log (D x d)   = D (log x)   (d / x)
  sin (D x d)   = D (sin x)   (d * cos x)
  cos (D x d)   = D (cos x)   (d * negate (sin x))
  tan (D x d)   = D (tan x)   (d / (cos x) ^ 2)
  asin (D x d)  = D (asin x)  (d / sqrt (1 - x * x))
  acos (D x d)  = D (acos x)  (d / negate (sqrt (1 - x * x)))
  atan (D x d)  = D (atan x)  (d / (1 + x * x))
  sinh (D x d)  = D (sinh x)  (d * cosh x)
  cosh (D x d)  = D (cosh x)  (d * sinh x)
  asinh (D x d) = D (asinh x) (d / sqrt (1 + x * x))
  acosh (D x d) = D (acosh x) (d / sqrt (x * x - 1))
  atanh (D x d) = D (atanh x) (d / (1 - x * x))
#endif

