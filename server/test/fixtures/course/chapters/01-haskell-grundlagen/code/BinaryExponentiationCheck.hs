{-# LANGUAGE ScopedTypeVariables #-}
import Control.Exception (evaluate)
import Data.IORef
import System.IO.Unsafe (unsafePerformIO)
import Workbook.Check
import BinaryExponentiation

-- A number type that counts every multiplication that is actually evaluated.
-- (A global counter, so shared sub-results are counted once, like in real life.)
newtype Counted = Counted Integer

{-# NOINLINE counter #-}
counter :: IORef Int
counter = unsafePerformIO (newIORef 0)

instance Num Counted where
  Counted a + Counted b = Counted (a + b)
  Counted a * Counted b = unsafePerformIO (modifyIORef' counter (+ 1) >> pure (Counted (a * b)))
  negate (Counted a)    = Counted (negate a)
  abs    (Counted a)    = Counted (abs a)
  signum (Counted a)    = Counted (signum a)
  fromInteger           = Counted

multiplications :: Counted -> Integer -> IO Int
multiplications x n = do
  writeIORef counter 0
  Counted r <- evaluate (power x n)
  _ <- evaluate r
  readIORef counter

main :: IO ()
main = runChecks
  [ eq "power 2 10 = 1024"        (power 2 10 :: Integer) 1024
  , eq "power 3 0 = 1"            (power 3 0 :: Integer) 1
  , eq "power 5 1 = 5"            (power 5 1 :: Integer) 5
  , eq "power 0 5 = 0"            (power 0 5 :: Integer) 0
  , eq "power (-2) 3 = -8"        (power (-2) 3 :: Integer) (-8)
  , approx "also works for Double: 1.5^2" (power 1.5 2) 2.25
  , prop "agrees with (^)" $ \(x :: Integer) (NonNegative (n :: Int)) ->
      let k = fromIntegral (n `mod` 40) in power x k == x ^ k
  , checkIO "uses O(log n) multiplications (n = 1000)" $
      (<= 25) <$> multiplications (Counted 2) 1000
  , checkIO "uses O(log n) multiplications (n = 2^20)" $
      (<= 25) <$> multiplications (Counted 1) (2 ^ (20 :: Int))
  ]
