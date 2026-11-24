
PATCH = {str(b+j):"0" for b in range(5220,5381,20) for j in range(1,11)}
PATCH.update({"5221":"100","5222":"200","5223":"-30","5241":"300","5242":"400","5243":"-60"})
def c(prog, patch=PATCH, **kwargs):
    return (prog, "mm", 0.0, (490,), {"ctx":{"var_patches":patch},**kwargs})
CASES.update({
 "plain":c("G53 G0 Z0\nG0 X10 Y10\nM2\n"),
 "g55_first":c("G55\nG0 X10\nG0 Y20 Z0\nM2\n"),
 "g55_with_move":c("G55 G0 X10\nG0 Y20 Z0\nM2\n"),
 "g92_first":c("G92 X7\nG0 Y10\nG0 X20 Z0\nM2\n"),
 "g20_first":c("G20 G91 G0 X1\nG90 G0 Y1 Z0\nM2\n"),
 "g43_first":c("G43.1 Z10\nG53 G0 Z0\nG0 X10 Y10\nM2\n"),
 "rotated":c("G53 G0 Z0\nG0 X10 Y10\nM2\n",patch={**PATCH,"5230":"30","5210":"1","5211":"7","5212":"9"}),
 "g55_zero":c("G55\nG0 X10\nG0 Y20 Z0\nM2\n",patch={str(b+j):"0" for b in range(5220,5381,20) for j in range(1,11)}),
})

CASES.update({
 "g55_rotary":c("G55\nG0 X10\nG0 Y20 Z0\nM2\n",rotary=True),
 "g55_preamble":c("G90\nG55\nG0 X10\nG0 Y20 Z0\nM2\n"),
})
