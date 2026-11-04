{-# LANGUAGE ScopedTypeVariables #-}
{-# OPTIONS_GHC -Wno-overlapping-patterns #-}
-- | A minimal test harness for workbook exercises.
--
-- An exercise's check program is an ordinary Haskell file with a @main@:
--
-- > import Workbook.Check
-- > import MyModule
-- >
-- > main :: IO ()
-- > main = runChecks
-- >   [ eq "square of 3" (square 3) 9
-- >   , prop "square is non-negative" (\x -> square x >= (0 :: Int))
-- >   ]
--
-- Every check reports @pass@, @fail@ (wrong answer, with a counterexample or
-- expected/actual) or @error@ (the student's code threw, e.g. it is still
-- @undefined@). Results are printed as marked JSON lines that the workbook
-- server turns into structured feedback; anything the student's code prints
-- is kept apart from them.
module Workbook.Check
  ( Check
  , runChecks
  , check
  , checkIO
  , eq
  , approx
  , prop
  , (~=)
  , named
  , module Test.QuickCheck
  ) where

import Control.Exception
import Data.Char (ord)
import Data.List (isInfixOf, isPrefixOf)
import Numeric (showHex)
import System.IO
import System.Timeout (timeout)
import Test.QuickCheck

data Outcome = Pass | Fail String | Err String | TimedOut

-- | A single named check.
data Check = Check String (IO Outcome)

-- | Give a check a different name.
named :: String -> Check -> Check
named n (Check _ io) = Check n io

-- | A boolean check.
check :: String -> Bool -> Check
check name b = Check name (pure (if b then Pass else Fail "evaluated to False"))

-- | A boolean check that needs IO (e.g. to count evaluation steps).
checkIO :: String -> IO Bool -> Check
checkIO name io = Check name $ do
  b <- io
  pure (if b then Pass else Fail "evaluated to False")

-- | @eq name actual expected@ compares with '=='.
eq :: (Eq a, Show a) => String -> a -> a -> Check
eq name actual expected = Check name $ do
  ok <- evaluate (actual == expected)
  if ok
    then pure Pass
    else do
      a <- evaluate (forceString (show actual))
      e <- evaluate (forceString (show expected))
      pure (Fail ("expected " ++ e ++ "\n but got " ++ a))

-- | @approx name actual expected@ compares doubles with a relative tolerance.
approx :: String -> Double -> Double -> Check
approx name actual expected = Check name $ do
  ok <- evaluate (actual ~= expected)
  if ok
    then pure Pass
    else do
      a <- evaluate (forceString (show actual))
      e <- evaluate (forceString (show expected))
      pure (Fail ("expected " ++ e ++ "\n but got " ++ a))

infix 4 ~=

-- | Approximate equality for use inside properties.
(~=) :: Double -> Double -> Bool
a ~= b
  | isNaN a || isNaN b = isNaN a && isNaN b
  | isInfinite a || isInfinite b = a == b
  | otherwise = abs (a - b) <= 1e-6 * max 1 (max (abs a) (abs b))

-- | A QuickCheck property (200 random cases).
prop :: Testable p => String -> p -> Check
prop name p = Check name $ do
  r <- quickCheckWithResult stdArgs {chatty = False, maxSuccess = 200, maxShrinks = 50} p
  pure $ case r of
    Success {} -> Pass
    Failure {output = o}
      | notImplemented o -> Err notImplementedMsg
      | otherwise -> Fail (trim o)
    GaveUp {} -> Err "gave up: too many generated cases were discarded"
    NoExpectedFailure {} -> Err "expected the property to fail, but it passed"
    _ -> Err "the property could not be evaluated"
  where
    trim = unwords' . filter (not . ("*** " `isPrefixOf`)) . lines
    unwords' = foldr (\l acc -> if null acc then l else l ++ "\n" ++ acc) ""

-- | Run all checks, one result line each, with a per-check time limit.
runChecks :: [Check] -> IO ()
runChecks cs = do
  hSetEncoding stdout utf8
  hSetBuffering stdout LineBuffering
  mapM_ run cs
  where
    run (Check name io) = do
      r <- try (timeout 5000000 (io >>= forceOutcome))
      emit name $ case r of
        Right (Just o) -> o
        Right Nothing -> TimedOut
        Left (e :: SomeException) -> classify e
    forceOutcome o = case o of
      Pass -> pure o
      Fail m -> evaluate (forceString m) >> pure o
      Err m -> evaluate (forceString m) >> pure o
      TimedOut -> pure o
    emit name o = do
      let (status, msg) = case o of
            Pass -> ("pass", "")
            Fail m -> ("fail", m)
            Err m -> ("error", m)
            TimedOut -> ("timeout", "took longer than 5 seconds (infinite loop?)")
      -- Leading newline: the student's code may have printed without one.
      putStrLn ""
      putStrLn ("@@WB@@" ++ json name status msg)
      hFlush stdout
    classify :: SomeException -> Outcome
    classify e =
      let msg = takeWhile' (displayException e)
       in if notImplemented msg then Err notImplementedMsg else Err msg
    takeWhile' = unlinesTrim . takeWhile (not . ("CallStack" `isPrefixOf`)) . lines
    unlinesTrim ls = foldr (\l acc -> if null acc then l else l ++ "\n" ++ acc) "" ls

-- | Did the student's code hit a stub (@undefined@ or a missing instance method)?
notImplemented :: String -> Bool
notImplemented msg = "No instance nor default method" `isInfixOf` msg || "Prelude.undefined" `isInfixOf` msg

notImplementedMsg :: String
notImplementedMsg = "not implemented yet (the code still evaluates to `undefined` or a missing method)"

-- Forces every character so exceptions inside 'show' surface here.
forceString :: String -> String
forceString s = length s `seq` s

json :: String -> String -> String -> String
json name status msg =
  "{\"name\":" ++ str name ++ ",\"status\":" ++ str status ++ ",\"message\":" ++ str msg ++ "}"
  where
    str s = "\"" ++ concatMap esc s ++ "\""
    esc c = case c of
      '"' -> "\\\""
      '\\' -> "\\\\"
      '\n' -> "\\n"
      '\r' -> "\\r"
      '\t' -> "\\t"
      _ | ord c < 0x20 -> "\\u" ++ replicate (4 - length (showHex (ord c) "")) '0' ++ showHex (ord c) ""
        | otherwise -> [c]
