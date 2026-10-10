"""Offline tests; periodic selector wake-up as documented in R116/R117.
No product function or assertion replaced. No timing proof.
"""
import asyncio, sys, unittest
class PollingPolicy(asyncio.DefaultEventLoopPolicy):
    def new_event_loop(self):
        loop=super().new_event_loop()
        def tick():
            if not loop.is_closed(): loop.call_later(.02,tick)
        loop.call_later(.02,tick)
        return loop
asyncio.set_event_loop_policy(PollingPolicy())
if __name__=='__main__':
    unittest.main(module=None,argv=[sys.argv[0],'-v',*sys.argv[1:]])
