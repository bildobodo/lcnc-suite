import {writeFileSync} from 'node:fs';
export default class EvidenceReporter {
 onTestEnd(test:any, result:any) {
  for(const a of result.attachments) if(a.body && a.contentType === 'image/png')
   writeFileSync('../evidence/viewer-palette-fest.r67.render-'+test.location.line+'-'+a.name.replace(/[^a-zA-Z0-9.-]/g,'_'),a.body);
 }
}
