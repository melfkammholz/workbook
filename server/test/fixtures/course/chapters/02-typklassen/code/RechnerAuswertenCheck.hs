import Expr
import Workbook.Check

main :: IO ()
main = runChecks
  [ eq "eine Zahl" (eval (Num 3)) 3
  , eq "Summe und Produkt" (eval (Mul (Num 2) (Add (Num 3) (Num 4)))) 14
  ]
