const fs=require('fs'),path=require('path'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.calendar-smoke');
fs.mkdirSync(out,{recursive:true});
let runtimeLabel;
if(process.env.BASEMENT_SMOKE_RUNTIME){
  // Explicit offline fallback: never reported as the app's real runtime.
  fs.copyFileSync(process.env.BASEMENT_SMOKE_RUNTIME,path.join(out,'runtime.js'));
  runtimeLabel=process.env.BASEMENT_SMOKE_RUNTIME_LABEL||'Explicit external compatibility runtime; NOT the production runtime';
}else{
  const packageRoot=name=>path.dirname(require.resolve(name+'/package.json',{paths:[root]}));
  const files={
    react:path.join(packageRoot('react'),'cjs/react.production.js'),
    'react-dom':path.join(packageRoot('react-dom'),'cjs/react-dom.production.js'),
    'react-dom/client':path.join(packageRoot('react-dom'),'cjs/react-dom-client.production.js'),
    scheduler:path.join(packageRoot('scheduler'),'cjs/scheduler.production.js'),
  };
  const defs=Object.entries(files).map(([name,file])=>JSON.stringify(name)+':function(module,exports,require){\n'+fs.readFileSync(file,'utf8')+'\n}');
  fs.writeFileSync(path.join(out,'runtime.js'),
    'const __runtime={'+defs.join(',')+'},__runtimeCache={};\n'+
    'function __runtimeRequire(id){if(__runtimeCache[id])return __runtimeCache[id].exports;const m={exports:{}};__runtimeCache[id]=m;if(!__runtime[id])throw Error("Missing runtime module "+id);__runtime[id](m,m.exports,__runtimeRequire);return m.exports;}\n'+
    'window.React=__runtimeRequire("react");window.ReactDOM=__runtimeRequire("react-dom/client");');
  runtimeLabel='React '+JSON.parse(fs.readFileSync(path.join(packageRoot('react'),'package.json'),'utf8')).version+' from installed project dependencies';
}
fs.copyFileSync(path.join(root,'tests/fixtures/v39-browser-mock.js'),path.join(out,'mock-api.js'));
fs.writeFileSync(path.join(out,'metadata.json'),JSON.stringify({runtime:runtimeLabel,scope:'Isolated calendar source components; all APIs mocked and all network blocked. Not a Next.js application build.'},null,2));
const seen=new Set(),defs=[];
function visit(f){
 f=path.resolve(f);let id=path.relative(root,f).replaceAll('\\','/');
 if(seen.has(id)||id==='lib/supabase-rest.ts')return id;seen.add(id);
 const code=ts.transpileModule(fs.readFileSync(f,'utf8'),{fileName:f,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
 const deps={};
 for(const m of code.matchAll(/require\("([^"]+)"\)/g)){
  const spec=m[1];if(spec==='react'){deps[spec]='react';continue}
  if(!spec.startsWith('.'))throw Error('Unexpected dependency '+spec);
  let p=path.resolve(path.dirname(f),spec);p=['.ts','.tsx','.js'].map(e=>p+e).find(fs.existsSync)||p;
  deps[spec]=visit(p);
 }
 defs.push(`${JSON.stringify(id)}:function(module,exports){const React=window.React;const map=${JSON.stringify(deps)};const require=id=>__req(map[id]);\n${code}\n}`);
 return id;
}
const cal=visit(root+'/app/dashboard/bookings-calendar.tsx'),theme=visit(root+'/lib/control-theme.tsx');
fs.writeFileSync(path.join(out,'components.js'),`
const __mods={${defs.join(',\n')}},__cache={};
function __req(id){if(id==='react')return window.React;if(id==='lib/supabase-rest.ts')return {api:window.mockApi};if(__cache[id])return __cache[id].exports;const m={exports:{}};__cache[id]=m;if(!__mods[id])throw Error('Missing component '+id);__mods[id](m,m.exports);return m.exports;}
const Calendar=__req(${JSON.stringify(cal)}).default,Theme=__req(${JSON.stringify(theme)}).ControlTheme;
const e=React.createElement;
ReactDOM.createRoot(document.getElementById('app')).render(e(React.StrictMode,null,e(Theme,null,e('main',{className:'control'},e('div',{className:'control-body menu-collapsed'},e('section',null,e(Calendar,{userId:'owner-test',owner:true,members:window.testMembers})))))));
`);
const css=['globals.css','dashboard.css','pwa.css','calendar-readability.css','booking-tools.css','member-portal.css','control-center-reference.css'].map(f=>fs.readFileSync(root+'/app/'+f,'utf8')).join('\n');
fs.writeFileSync(out+'/styles.css',css);
fs.writeFileSync(out+'/index.html','<!doctype html><html lang="el"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>V39 — isolated calendar QA</title><link rel="stylesheet" href="styles.css"></head><body><div id="app"></div><script src="runtime.js"></script><script src="mock-api.js"></script><script src="components.js"></script></body></html>');
console.log('Bundled',seen.size,'calendar source modules;',runtimeLabel,'; APIs mocked. Output:',out);
