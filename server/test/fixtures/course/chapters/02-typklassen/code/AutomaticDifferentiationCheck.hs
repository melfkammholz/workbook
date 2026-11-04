import Workbook.Check
import Playground.AutomaticDifferentiation

-- `D` is not exported, so the checks cannot name it. Fixing the argument to
-- Double is enough: the result type is inferred from how it is compared.
d1' f x = d1 f (x :: Double)
d2' f x = d2 f (x :: Double)

small :: Gen Double
small = choose (-10, 10)

main :: IO ()
main = runChecks
  [ -- Num ---------------------------------------------------------------
    approx "constant: d/dx 7 = 0"                (d1' (const 7) 3) 0
  , approx "identity: d/dx x = 1"                (d1' id 3) 1
  , approx "sum rule: d/dx (x + 5x) = 6"         (d1' (\x -> x + 5 * x) 1) 6
  , approx "difference: d/dx (10 - x²) at 3 = -6" (d1' (\x -> 10 - x * x) 3) (-6)
  , approx "product rule: d/dx x² at 3 = 6"      (d1' (\x -> x * x) 3) 6
  , approx "product rule: d/dx x³ at 2 = 12"     (d1' (\x -> x * x * x) 2) 12
  , approx "negate: d/dx (-x) = -1"              (d1' negate 2) (-1)
  , approx "abs: d/dx |x| at 3 = 1"              (d1' abs 3) 1
  , approx "abs: d/dx |x| at -3 = -1"            (d1' abs (-3)) (-1)
  , approx "signum: d/dx sgn x at 2 = 0"         (d1' signum 2) 0
    -- Fractional --------------------------------------------------------
  , approx "reciprocal: d/dx 1/x at 2 = -1/4"    (d1' (\x -> 1 / x) 2) (-0.25)
  , approx "quotient: d/dx x/(x+1) at 1 = 1/4"   (d1' (\x -> x / (x + 1)) 1) 0.25
  , approx "rational literal: d/dx 0.5x = 0.5"   (d1' (\x -> 0.5 * x) 3) 0.5
    -- Floating ----------------------------------------------------------
  , approx "pi is constant"                      (d1' (\x -> pi * x) 2) pi
  , approx "exp"                                 (d1' exp 1) (exp 1)
  , approx "log"                                 (d1' log 4) 0.25
  , approx "sin"                                 (d1' sin 0.5) (cos 0.5)
  , approx "cos"                                 (d1' cos 0.5) (negate (sin 0.5))
  , approx "tan"                                 (d1' tan 0.5) (1 / cos 0.5 ^ (2 :: Int))
  , approx "asin"                                (d1' asin 0.5) (1 / sqrt 0.75)
  , approx "acos"                                (d1' acos 0.5) (-1 / sqrt 0.75)
  , approx "atan"                                (d1' atan 2) 0.2
  , approx "sinh"                                (d1' sinh 1) (cosh 1)
  , approx "cosh"                                (d1' cosh 1) (sinh 1)
  , approx "asinh"                               (d1' asinh 1) (1 / sqrt 2)
  , approx "acosh"                               (d1' acosh 2) (1 / sqrt 3)
  , approx "atanh"                               (d1' atanh 0.5) (1 / 0.75)
  , approx "chain rule: d/dx sin(x²) at 1"       (d1' (\x -> sin (x * x)) 1) (2 * cos 1)
  , approx "chain rule: d/dx exp(sin x) at 0"    (d1' (exp . sin) 0) 1
  , approx "sqrt (via the default methods)"      (d1' sqrt 4) 0.25
    -- second derivatives --------------------------------------------------
  , approx "d2: x³ at 2 = 12"                    (d2' (\x -> x * x * x) 2) 12
  , approx "d2: sin at π/2 = -1"                 (d2' sin (pi / 2)) (-1)
  , approx "d2: exp at 1 = e"                    (d2' exp 1) (exp 1)
  , approx "d2: 1/x at 2 = 1/4"                  (d2' (\x -> 1 / x) 2) 0.25
    -- properties --------------------------------------------------------
  , prop "d/dx (ax² + bx + c) = 2ax + b" $
      forAll small $ \a -> forAll small $ \b ->
      forAll small $ \c -> forAll small $ \x ->
        d1' (\v -> realToFrac a * v * v + realToFrac b * v + realToFrac c) x ~= 2 * a * x + b
  ]
