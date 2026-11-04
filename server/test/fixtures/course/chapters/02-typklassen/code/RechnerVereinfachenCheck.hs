import Expr
import Workbook.Check

main :: IO ()
main = runChecks
  [ eq "0 + x" (simplify (Add (Num 0) (Num 5))) (Num 5)
  , eq "1 * x, auch innen" (simplify (Add (Num 2) (Mul (Num 1) (Num 7)))) (Add (Num 2) (Num 7))
  ]
