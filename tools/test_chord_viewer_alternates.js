const fs=require('fs'),vm=require('vm');
class El {
  constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners={};this.dataset={};this.attributes={};this.className='';this.textContent='';this.innerHTML='';this.tabIndex=0;}
  appendChild(x){this.children.push(x);return x;}
  append(...xs){this.children.push(...xs);}
  addEventListener(type,fn){(this.listeners[type]||(this.listeners[type]=[])).push(fn);}
  dispatch(type,event={}){for(const fn of this.listeners[type]||[])fn({preventDefault(){},...event});}
  setAttribute(k,v){this.attributes[k]=String(v);}
  closest(sel){return this._closest && this._closest(sel);}
  contains(){return true;}
}
const root=new El('div');
const chord=new El('span');chord.dataset.chord='Am';chord.textContent='Am';chord._closest=sel=>sel==='.chord-tag[data-chord]'?chord:null;
let modal=null;
const ctx={console,document:{getElementById:id=>id==='lyrics-container'?root:null,createElement:tag=>new El(tag)}};ctx.window=ctx;
vm.runInNewContext(fs.readFileSync(__dirname+'/../js/chord-viewer.js','utf8'),ctx);
ctx.SongChordViewer.bind({
  openModal:(title,body,opts)=>{modal={title,body,opts}},
  renderVoicings:()=>[{svg:'<svg>A</svg>'},{svg:'<svg>B</svg>'},{svg:'<svg>C</svg>'}],
  unavailableText:()=> 'none', previousVoicingText:()=> 'prev', nextVoicingText:()=> 'next'
});
root.dispatch('click',{target:chord});
let failed=0;
const ok1=modal&&modal.title==='Am'&&modal.opts.variant==='chord-viewer'&&modal.body.children.length===2;
console.log(ok1?'PASS':'FAIL','popup opens with alternate-voicing controls');if(!ok1)failed++;
const diagram=modal.body.children[0], nav=modal.body.children[1], prev=nav.children[0], count=nav.children[1], next=nav.children[2];
const ok2=diagram.innerHTML.includes('A')&&count.textContent==='1 / 3';console.log(ok2?'PASS':'FAIL','first voicing rendered');if(!ok2)failed++;
next.dispatch('click');
const ok3=diagram.innerHTML.includes('B')&&count.textContent==='2 / 3';console.log(ok3?'PASS':'FAIL','next arrow cycles voicing');if(!ok3)failed++;
prev.dispatch('click');
const ok4=diagram.innerHTML.includes('A')&&count.textContent==='1 / 3';console.log(ok4?'PASS':'FAIL','previous arrow cycles back');if(!ok4)failed++;
if(failed)process.exit(1);
