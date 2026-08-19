/* Oracle stub — kinematics.h stand-in for comp C bodies that include only
 * <rtapi_math.h> + <kinematics.h> (halcompile's generated prologue supplies
 * the rest upstream; here this header does). See ../README.md. */
#ifndef ORACLE_STUB_KINEMATICS_H
#define ORACLE_STUB_KINEMATICS_H
#include "motion.h" /* EmcPose, KINEMATICS_*, kparms */
#include "hal.h"    /* handle-style pin API */
#ifndef EXPORT_SYMBOL
#define EXPORT_SYMBOL(x)
#endif
#ifndef RTAPI_MSG_INFO
#define RTAPI_MSG_INFO 3
#endif
typedef unsigned int rtapi_u32;
extern int comp_id; /* upstream: inherited from rtapi_main(); defined by the harness */
#endif
