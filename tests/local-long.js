const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),cp=require('node:child_process');
const source=fs.readFileSync('agent-prototype/bulkrunner.js','utf8'), mod={exports:{}};
const sandbox={module:mod,Buffer,process,require(name){if(name!=='child_process')throw Error('Unexpected module');return {execFile(file,args){return cp.spawn(file,args.slice(1),{stdio:['pipe','pipe','pipe']});}};}};
vm.runInNewContext(source,sandbox);
const timer=setTimeout(()=>{console.error('Timeout');process.exitCode=1;},15000);
mod.exports.consoleaction({attempt:'f'.repeat(32),op:'run',os:'windows',script:'#'.repeat(30000)+'\nWrite-Output BR_LONG_TEST; exit 7'},null,null,{SendCommand(m){if(m.event!=='finished')return;clearTimeout(timer);try{assert.equal(m.exitCode,7);assert.match(m.stdout,/BR_LONG_TEST/);console.log('Long PowerShell diagnostic passed');}catch(e){console.error(e);process.exitCode=1;}}});
