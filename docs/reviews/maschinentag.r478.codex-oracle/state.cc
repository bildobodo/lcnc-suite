// R478 offline probe. Upstream tooldata_common.cc is unchanged; only the
// shared table is an array. This is NOT an NML/io/task execution test.
#include <cstdio>
#include <cstring>
#include <cerrno>
#include "tooldata.hh"
static CANON_TOOL_TABLE tab[CANON_POCKETS_MAX];
static int last_idx=0;
void tooldata_reset(void) { for(auto &t:tab)t=tooldata_entry_init(); }
void tooldata_last_index_set(int i) { last_idx=i; }
int tooldata_last_index_get(void) { return last_idx; }
toolidx_t tooldata_put(CANON_TOOL_TABLE t,int idx) {
  if(idx<0||idx>=CANON_POCKETS_MAX)return IDX_FAIL;
  tab[idx]=t;if(idx>last_idx){last_idx=idx;return IDX_NEW;}return IDX_OK;
}
toolidx_t tooldata_get(CANON_TOOL_TABLE *t,int idx) {
  if(idx<0||idx>=CANON_POCKETS_MAX)return IDX_FAIL;
  *t=tab[idx];return IDX_OK;
}
int tooldata_db_getall(void) {return -1;}
static char comments[CANON_POCKETS_MAX][CANON_TOOL_ENTRY_LEN];
int main(int argc,char **argv) {
  if(argc!=4)return 2;
  static char *ptr[CANON_POCKETS_MAX];
  for(int i=0;i<CANON_POCKETS_MAX;i++)ptr[i]=comments[i];
  tooldata_init(false);tooldata_reset();
  if(tooldata_load(argv[1],ptr)!=0)return 3;
  int rc=0;
  if(!strcmp(argv[3],"load")) {
    rc=tooldata_load(argv[2],ptr);printf("LOAD rc=%d\n",rc);
  } else {
    // ioControl.cc:1006-1021: change public fields in memory, then save.
    // For this request only Z differs; P and comment are retained there.
    CANON_TOOL_TABLE t;tooldata_get(&t,1);
    t.offset.tran.z=11;
    tooldata_put(t,1);
    errno=0;rc=tooldata_save(argv[2],ptr);
    printf("SAVE rc=%d errno=%d\n",rc,errno);
  }
  for(int i=1;i<=last_idx;i++) {
    const auto &t=tab[i];if(t.toolno==-1)continue;
    printf("ROW %d %d %d %.17g %.17g %.17g %.17g %.17g %.17g %.17g %.17g %.17g %.17g %.17g %.17g %d|%s\n",
      i,t.toolno,t.pocketno,t.offset.tran.x,t.offset.tran.y,t.offset.tran.z,
      t.offset.a,t.offset.b,t.offset.c,t.offset.u,t.offset.v,t.offset.w,
      t.diameter,t.frontangle,t.backangle,t.orientation,comments[i]);
  }
  return 0;
}
