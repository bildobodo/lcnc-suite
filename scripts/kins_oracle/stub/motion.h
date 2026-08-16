/* Oracle stub — minimal stand-in for LinuxCNC motion.h (see ../README.md) */
#ifndef ORACLE_STUB_MOTION_H
#define ORACLE_STUB_MOTION_H
#include <stdbool.h>
#include "rtapi.h"  /* the real motion.h chain provides rtapi_print* transitively */
#define EMCMOT_MAX_JOINTS 16
#define EMCMOT_MAX_AXIS 9
typedef struct { double x, y, z; } PmCartesian;
typedef struct { PmCartesian tran; double a, b, c, u, v, w; } EmcPose;
typedef int KINEMATICS_FORWARD_FLAGS;
typedef int KINEMATICS_INVERSE_FLAGS;
typedef enum {
  KINEMATICS_IDENTITY = 1, KINEMATICS_FORWARD_ONLY,
  KINEMATICS_INVERSE_ONLY, KINEMATICS_BOTH
} KINEMATICS_TYPE;
KINEMATICS_TYPE kinematicsType(void);
typedef struct kparms {
  char *kinsname;
  char *halprefix;
  char *required_coordinates;
  int   max_joints;
  int   allow_duplicates;
} kparms;
int map_coordinates_to_jnumbers(const char *coordinates, const int max_joints,
                                const int allow_duplicates, int axis_idx_for_jno[]);
int position_to_mapped_joints(const int max_joints, const EmcPose *pos, double *joints);
int mapped_joints_to_position(const int max_joints, const double *joints, EmcPose *pos);
#endif
