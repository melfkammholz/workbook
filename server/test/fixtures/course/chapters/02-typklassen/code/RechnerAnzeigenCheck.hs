import Expr
import Pretty
import Workbook.Check

main :: IO ()
main = runChecks
  [ eq "ohne Klammern" (pretty (Add (Num 1) (Num 2))) "1 + 2"
  , eq "mit Klammern" (pretty (Mul (Num 2) (Add (Num 3) (Num 4)))) "2 * (3 + 4)"
  ]
