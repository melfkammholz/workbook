module Pretty (pretty) where

import Expr

-- | Zeigt einen Ausdruck mit so wenigen Klammern wie nötig an.
pretty :: Expr -> String
#ifdef TEMPLATE rechner-anzeigen
pretty = undefined
#else
pretty = go (0 :: Int)
  where
    go _ (Num n) = show n
    go p (Add a b) = paren (p > 0) (go 0 a ++ " + " ++ go 0 b)
    go _ (Mul a b) = go 1 a ++ " * " ++ go 1 b
    paren True s = "(" ++ s ++ ")"
    paren False s = s
#endif
