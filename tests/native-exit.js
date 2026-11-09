const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),cp=require('node:child_process');
const source=fs.readFileSync('modules_meshcore/bulkrunner.js','utf8'),mod={exports:{}};
vm.runInNewContext(source,{module:mod,Buffer,process,require(n){if(n==='MeshAgent')throw Error('mock');return {execFile(file,args){return cp.spawn(file,args.slice(1),{stdio:['pipe','pipe','pipe']});}};}});
const timer=setTimeout(()=>{console.error('Timeout');process.exitCode=1;},15000);
mod.exports.consoleaction({attempt:'e'.repeat(32),op:'run',os:'windows',script:'cmd.exe /c exit 7'},null,null,{SendCommand(m){if(m.event!=='finished')return;clearTimeout(timer);try{assert.equal(m.exitCode,7);console.log('Native failure exit code passed');}catch(e){console.error(e);process.exitCode=1;}}});
