{-# LANGUAGE ScopedTypeVariables #-}
import Prelude hiding (gcd)
import qualified Prelude as P
import Workbook.Check
import Gcd

main :: IO ()
main = runChecks
  [ eq "gcd 12 18 = 6"            (gcd (12 :: Int) 18) 6
  , eq "gcd 17 5 = 1"             (gcd (17 :: Int) 5) 1
  , eq "gcd 0 7 = 7"              (gcd (0 :: Int) 7) 7
  , eq "gcd 7 0 = 7"              (gcd (7 :: Int) 0) 7
  , eq "gcd (-12) 18 = 6"         (gcd (-12 :: Int) 18) 6
  , eq "works for Integer"        (gcd (2 ^ (70 :: Int)) (6 ^ (40 :: Int)) :: Integer) (2 ^ (40 :: Int))
  , prop "gcd agrees with Prelude.gcd" $ \(x :: Int) (y :: Int) -> gcd x y == P.gcd x y

  , eq "primeFactors 12"          (primeFactors 12) [2, 2, 3]
  , eq "primeFactors 97 (prime)"  (primeFactors 97) [97]
  , eq "primeFactors 1"           (primeFactors 1) []
  , eq "primeFactors 360"         (primeFactors 360) [2, 2, 2, 3, 3, 5]
  , prop "primeFactors multiply back" $ \(Positive (n :: Integer)) ->
      product (primeFactors (n `mod` 5000 + 1)) == n `mod` 5000 + 1

  , eq "gcdPF 12 18 = 6"          (gcdPF 12 18) 6
  , eq "gcdPF 17 5 = 1"           (gcdPF 17 5) 1
  , eq "gcdPF 360 84 = 12"        (gcdPF 360 84) 12
  , prop "gcdPF agrees with Prelude.gcd" $ \(Positive (x :: Integer)) (Positive (y :: Integer)) ->
      let a = x `mod` 2000 + 1; b = y `mod` 2000 + 1 in gcdPF a b == P.gcd a b
  ]
