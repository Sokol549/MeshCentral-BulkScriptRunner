const assert = require('node:assert/strict'), Dispatcher = require('../dispatcher');
let active = 0, peak = 0, complete = 0;
const pool = new Dispatcher({ concurrency:10, timeout:10, targets:Array.from({length:100},(_,i)=>({node_id:String(i),online:true})), transport:{start(row,done){active++;peak=Math.max(peak,active);setImmediate(()=>{active--;complete++;done({confirmed:true,exit_code:0});});return {cancel(){}};}}, onChange(rows){if(rows.every(r=>r.status==='Success')){assert.equal(complete,100);assert.equal(peak,10);console.log('100 target concurrency check passed');}} });
pool.start();
