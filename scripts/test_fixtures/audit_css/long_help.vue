<template>
  <div>
    <label>Safe Z<HelpIcon label="Safe Z">Safe Z height in work coordinates for retraction between scan probe points. Set above the highest point of the workpiece plus clearance for clamps. (#3058)</HelpIcon></label>
    <label>Depth<HelpIcon label="Depth">How far each point searches down — deeper than the lowest spot.</HelpIcon></label>
    <MachineToggle label="Use Tool Table" help="When enabled, uses the tool table length to calculate a closer probe start height — faster for known tools. Disable during initial setup." />
    <MachineToggle label="Return" help="Return to where M600 was called after measuring." />
    <span>Mode<HelpIcon label="Mode">
      <strong>Machine</strong> — the machine axes<br><strong>TCP</strong> — the tip stays on the part while A turns
    </HelpIcon></span>
  </div>
</template>
