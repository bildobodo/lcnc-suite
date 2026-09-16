description = "LCNC form-offset coordinate audit";
vendor = "LCNC Suite audit";
extension = "json";
capabilities = CAPABILITY_MILLING;
tolerance = spatial(0.001, MM);
minimumChordLength = spatial(0.001, MM);
var references = [];
var parameters = {};
var active = null;

function onParameter(name, value) {
  if (/tip|offset|length/i.test(name)) {
    parameters[name] = value;
  }
}

function onSection() {
  active = {
    section: getCurrentSectionId(),
    diameter: tool.diameter,
    overallLength: tool.overallLength,
    bodyLength: tool.bodyLength,
    cutterSVG: tool.getCutterProfileAsSVGPath(),
    parameters: parameters,
    moves: []
  };
  references.push(active);
}

function onRapid(x, y, z) {
  active.moves.push({kind:"rapid", xyz:[x,y,z]});
}

function onLinear(x, y, z, feed) {
  active.moves.push({kind:"linear", xyz:[x,y,z], feed:feed});
}

function onClose() {
  writeln(JSON.stringify({schema:1, outputUnit:unit, tools:references}));
}
