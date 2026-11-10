import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {readFile} from "node:fs/promises";
import {dirname,join} from "node:path";
const exec=promisify(execFile);
export async function projectAcceptance(cwd:string,base:string) {
  const command="Companion: baseline npm test";
  try {
    const git=(...args:string[])=>exec("git",args,{cwd,windowsHide:true,maxBuffer:4_000_000});
    const original=(await git("show",base+":package.json")).stdout;
    if(original!==await readFile(join(cwd,"package.json"),"utf8") && original.replace(/\r\n/g,"\n")!==(await readFile(join(cwd,"package.json"),"utf8")).replace(/\r\n/g,"\n")) throw Error("Test manifest changed");
    const scripts=JSON.parse(original).scripts;
    if(typeof scripts?.test!=="string"||!scripts.test.trim())throw Error("No baseline npm test script");
    const changed=(await git("diff","--no-renames","--name-only","-z",base)).stdout.split("\0");
    if(changed.some(p=>/(^|\/)(tests?|__tests__|fixtures|scripts|node_modules)(\/|$)|\.(test|spec)\.|(^|\/)(package(-lock)?\.json|.*\.config\.[^/]+|tsconfig[^/]*\.json|\.npmrc)$/i.test(p)))throw Error("Acceptance inputs changed; independent review required");
    const node=process.platform==="win32"?join(process.env.ProgramFiles || "C:/Program Files","nodejs","node.exe"):"node";
    await exec(process.platform==="win32"?node:"npm",process.platform==="win32"?[join(dirname(node),"node_modules/npm/bin/npm-cli.js"),"test"]:["test"],{cwd,env:{...process.env,CI:"true"},windowsHide:true,timeout:120000,maxBuffer:4_000_000});
    return {command,exit:0};
  }catch(error){const e=error as Error & {code?:unknown;stdout?:string;stderr?:string};return {command:command+" — "+(e.code!==undefined?"could not complete successfully ("+e.code+")":e.message),exit:1,output:((e.stdout??"")+"\n"+(e.stderr??"")).slice(-12000)};}
}
