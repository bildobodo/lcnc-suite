/* Oracle harness (TCP+TWP plan phase 1b): drives the REAL LinuxCNC
 * xyzac/xyzbc-trt kinematics — trtKinematicsSetup runs unmodified
 * (coordinate mapping, principal joints, pin allocation via the hal.h
 * stub) — over a stdin case stream. Protocol in README.md. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "trtfuncs.c"   /* same TU: the file's statics stay internal but reachable */

KINEMATICS_TYPE kinematicsType(void) { return KINEMATICS_BOTH; }

int main(int argc, char **argv) {
  if (argc != 9) {
    fprintf(stderr, "usage: harness <xyzac|xyzbc> xrot yrot zrot xoff yoff zoff tooloff\n");
    return 2;
  }
  int isbc = strcmp(argv[1], "xyzbc") == 0;
  if (!isbc && strcmp(argv[1], "xyzac") != 0) { fprintf(stderr, "bad kins\n"); return 2; }

  kparms kp = {0};
  kp.kinsname = "oracle";
  kp.halprefix = "oracle";
  kp.required_coordinates = isbc ? "xyzbc" : "xyzac";
  kp.max_joints = 5;
  kp.allow_duplicates = 0;
  if (trtKinematicsSetup(0, isbc ? "XYZBC" : "XYZAC", &kp)) return 3;

  *haldata->x_rot_point = atof(argv[2]);
  *haldata->y_rot_point = atof(argv[3]);
  *haldata->z_rot_point = atof(argv[4]);
  *haldata->x_offset    = atof(argv[5]);
  *haldata->y_offset    = atof(argv[6]);
  *haldata->z_offset    = atof(argv[7]);
  *haldata->tool_offset = atof(argv[8]);

  char line[512];
  while (fgets(line, sizeof line, stdin)) {
    char op;
    double v[6];
    if (sscanf(line, " %c %lf %lf %lf %lf %lf %lf",
               &op, &v[0], &v[1], &v[2], &v[3], &v[4], &v[5]) != 7) continue;
    if (op == 'F') {
      double joints[EMCMOT_MAX_JOINTS] = {0};
      for (int i = 0; i < 5; i++) joints[i] = v[i];
      EmcPose p; memset(&p, 0, sizeof p);
      int r = isbc ? xyzbcKinematicsForward(joints, &p, 0, 0)
                   : xyzacKinematicsForward(joints, &p, 0, 0);
      if (r) { printf("ERR\n"); continue; }
      printf("%.17g %.17g %.17g %.17g %.17g %.17g\n",
             p.tran.x, p.tran.y, p.tran.z, p.a, p.b, p.c);
    } else if (op == 'I') {
      EmcPose p; memset(&p, 0, sizeof p);
      p.tran.x = v[0]; p.tran.y = v[1]; p.tran.z = v[2];
      p.a = v[3]; p.b = v[4]; p.c = v[5];
      double joints[EMCMOT_MAX_JOINTS] = {0};
      int r = isbc ? xyzbcKinematicsInverse(&p, joints, 0, 0)
                   : xyzacKinematicsInverse(&p, joints, 0, 0);
      if (r) { printf("ERR\n"); continue; }
      printf("%.17g %.17g %.17g %.17g %.17g\n",
             joints[0], joints[1], joints[2], joints[3], joints[4]);
    }
  }
  return 0;
}
