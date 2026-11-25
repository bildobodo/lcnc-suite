// Oracle: upstream v2.9.4 tooldata_load (tooldata_common.cc unchanged), the
// mmap replaced by an array. Prints every home entry: idx T P fields.
#include <stdio.h>
#include <string.h>
#include "tooldata.hh"
static CANON_TOOL_TABLE tab[CANON_POCKETS_MAX];
static int last_idx = 0;
static tooldb_t dbm = DB_NOTUSED;
void tooldata_reset(void){ CANON_TOOL_TABLE e = tooldata_entry_init(); for(int i=0;i<CANON_POCKETS_MAX;i++) tab[i]=e; }
void tooldata_last_index_set(int i){ last_idx=i; }
int tooldata_last_index_get(void){ return last_idx; }
toolidx_t tooldata_put(struct CANON_TOOL_TABLE t,int idx){ if(idx<0||idx>=CANON_POCKETS_MAX) return IDX_FAIL; tab[idx]=t; if(idx>last_idx){last_idx=idx;return IDX_NEW;} return IDX_OK; }
toolidx_t tooldata_get(CANON_TOOL_TABLE* p,int idx){ if(idx<0||idx>=CANON_POCKETS_MAX) return IDX_FAIL; *p=tab[idx]; return IDX_OK; }
int tooldata_db_getall(void){ return -1; }
static char cbuf[CANON_POCKETS_MAX][CANON_TOOL_ENTRY_LEN];
int main(int argc,char**argv){
  static char* c[CANON_POCKETS_MAX]; for(int i=0;i<CANON_POCKETS_MAX;i++) c[i]=cbuf[i];
  tooldata_init(false); tooldata_reset();
  int rc = tooldata_load(argv[1], c);
  fprintf(stderr,"rc=%d last=%d\n",rc,last_idx);
  for(int i=1;i<=last_idx;i++){ CANON_TOOL_TABLE&t=tab[i]; if(t.toolno==-1) continue;
    printf("ROW %d %d %d %.17g %.17g %.17g %.17g %.17g %.17g %.17g %.17g %.17g %.17g %.17g %.17g %d|%s\n",i,t.toolno,t.pocketno,t.offset.tran.x,t.offset.tran.y,t.offset.tran.z,t.offset.a,t.offset.b,t.offset.c,t.offset.u,t.offset.v,t.offset.w,t.diameter,t.frontangle,t.backangle,t.orientation,cbuf[i]); }
  (void)dbm; return 0; }
