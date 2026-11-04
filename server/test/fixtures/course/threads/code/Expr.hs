module Expr (Expr (..), eval, simplify) where

-- | Arithmetische Ausdrücke.
data Expr = Num Int | Add Expr Expr | Mul Expr Expr
  deriving (Eq, Show)

-- | Berechnet den Wert eines Ausdrucks.
eval :: Expr -> Int
#ifdef TEMPLATE rechner-auswerten
eval = undefined
#else
eval (Num n) = n
eval (Add a b) = eval a + eval b
eval (Mul a b) = eval a * eval b
#endif

-- | Entfernt @0 + x@ und @1 * x@.
simplify :: Expr -> Expr
#ifdef TEMPLATE rechner-vereinfachen
simplify = undefined
#else
simplify (Add a b) = case (simplify a, simplify b) of
  (Num 0, y) -> y
  (x, Num 0) -> x
  (x, y) -> Add x y
simplify (Mul a b) = case (simplify a, simplify b) of
  (Num 1, y) -> y
  (x, Num 1) -> x
  (x, y) -> Mul x y
simplify e = e
#endif
