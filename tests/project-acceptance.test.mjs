import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFileSync} from "node:child_process";
import {projectAcceptance} from "../src/project-acceptance.ts";
test("lead commands cannot substitute for the baseline suite",async()=>{
 const cwd=mkdtempSync(join(tmpdir(),"rc-gate-"));const write=(p,s)=>writeFileSync(join(cwd,p),s);
 const git=(...a)=>execFileSync("git",a,{cwd,stdio:"ignore"});
 try{git("init");write("package.json",JSON.stringify({scripts:{test:"node suite.test.cjs"}}));write("suite.test.cjs","require('assert').equal(require('./value.cjs'),1)");write("value.cjs","module.exports=0");git("add",".");git("-c","user.name=Test","-c","user.email=test@invalid","commit","-m","fixture");
 assert.equal((await projectAcceptance(cwd,"HEAD")).exit,1);
 write("value.cjs","module.exports=1");assert.equal((await projectAcceptance(cwd,"HEAD")).exit,0);
 write("suite.test.cjs","");assert.equal((await projectAcceptance(cwd,"HEAD")).exit,1);
 write("package.json",'{"scripts":{"test":"echo pass"}}');assert.equal((await projectAcceptance(cwd,"HEAD")).exit,1);
 }finally{rmSync(cwd,{recursive:true,force:true});}
});
