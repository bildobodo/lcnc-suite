/* Oracle harness (TCP+TWP plan phase 3): drives the REAL upstream
 * xyzacb_trsrn.comp switchable kinematics (LinuxCNC master @493926b56c,
 * GPL-2, David Mueller) — the C body after the `;;` separator is
 * extracted verbatim at build time (halcompile-equivalent split, done by
 * gen_kins_fixtures.py) and included here as one TU, so kinematicsSwitch
 * and the per-call pin reads run unmodified.
 *
 * Protocol:
 *   harness_trsrn <y_pivot> <z_pivot> <x_offset> <y_offset>
 *                 <y_rot_axis> <z_rot_axis> <nut_angle_deg> <tool_offset_z>
 * stdin lines:
 *   S <type>                        -> "OK"   switchkins mode 0|1|2
 *   P <pre_rot_RAD> <th1_DEG> <th2_DEG> -> "OK"  plane params (remap.py
 *        writes pre-rot in RADIANS, primary/secondary in DEGREES)
 *   F j0 j1 j2 j3 j4 j5             -> world "x y z a b c"
 *   I x y z a b c                   -> joints "j0 j1 j2 j3 j4 j5"
 * 17 significant digits, one result line per input line; "ERR" on failure.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int comp_id = 1; /* the comp inherits this from rtapi_main() upstream */
#include "xyzacb_trsrn_body.c" /* generated at build time — not in-tree */

int main(int argc, char **argv) {
  if (argc != 9) {
    fprintf(stderr,
            "usage: harness_trsrn y_pivot z_pivot x_offset y_offset "
            "y_rot_axis z_rot_axis nut_angle_deg tool_offset_z\n");
    return 2;
  }
  if (kinematicsType() != KINEMATICS_BOTH) return 3; /* triggers lazy setup */
  *haldata->y_pivot = atof(argv[1]);
  *haldata->z_pivot = atof(argv[2]);
  *haldata->x_offset = atof(argv[3]);
  *haldata->y_offset = atof(argv[4]);
  *haldata->y_rot_axis = atof(argv[5]);
  *haldata->z_rot_axis = atof(argv[6]);
  *haldata->nut_angle = atof(argv[7]);
  *haldata->tool_offset_z = atof(argv[8]);

  char line[512];
  while (fgets(line, sizeof line, stdin)) {
    char op = 0;
    double v[6] = {0};
    int n = sscanf(line, " %c %lf %lf %lf %lf %lf %lf", &op, &v[0], &v[1],
                   &v[2], &v[3], &v[4], &v[5]);
    if (op == 'S' && n == 2) {
      kinematicsSwitch((int)v[0]);
      puts("OK");
    } else if (op == 'P' && n == 4) {
      *haldata->pre_rot = v[0];
      *haldata->prim_angle = v[1];
      *haldata->sec_angle = v[2];
      puts("OK");
    } else if (op == 'F' && n == 7) {
      EmcPose p;
      memset(&p, 0, sizeof p);
      if (kinematicsForward(v, &p, NULL, NULL))
        puts("ERR");
      else
        printf("%.17g %.17g %.17g %.17g %.17g %.17g\n", p.tran.x, p.tran.y,
               p.tran.z, p.a, p.b, p.c);
    } else if (op == 'I' && n == 7) {
      EmcPose p;
      memset(&p, 0, sizeof p);
      p.tran.x = v[0]; p.tran.y = v[1]; p.tran.z = v[2];
      p.a = v[3]; p.b = v[4]; p.c = v[5];
      double j[16];
      memset(j, 0, sizeof j);
      if (kinematicsInverse(&p, j, NULL, NULL))
        puts("ERR");
      else
        printf("%.17g %.17g %.17g %.17g %.17g %.17g\n", j[0], j[1], j[2],
               j[3], j[4], j[5]);
    } else {
      puts("ERR");
    }
    fflush(stdout);
  }
  return 0;
}
