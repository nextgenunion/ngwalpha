const fs=require('fs'),vm=require('vm');
class El {
  constructor(tag='div'){
    this.tagName=tag;this.children=[];this.listeners={};this.dataset={};this.attributes={};
    this.className='';this.textContent='';this._innerHTML='';this.tabIndex=0;this.hidden=false;this.type='';
  }
  appendChild(x){this.children.push(x);return x;}
  append(...xs){this.children.push(...xs);}
  addEventListener(type,fn){(this.listeners[type]||(this.listeners[type]=[])).push(fn);}
  dispatch(type,event={}){for(const fn of this.listeners[type]||[])fn({preventDefault(){},...event});}
  setAttribute(k,v){this.attributes[k]=String(v);}
  getAttribute(k){return this.attributes[k];}
  closest(sel){return this._closest && this._closest(sel);}
  contains(){return true;}
  set innerHTML(v){this._innerHTML=String(v);this.children=[];}
  get innerHTML(){return this._innerHTML;}
}
const root=new El('div');
const chord=new El('span');chord.dataset.chord='Am';chord.textContent='Am';chord._closest=sel=>sel==='.chord-tag[data-chord]'?chord:null;
let modal=null;
const ctx={console,document:{getElementById:id=>id==='lyrics-container'?root:null,createElement:tag=>new El(tag)}};ctx.window=ctx;
vm.runInNewContext(fs.readFileSync(__dirname+'/../js/chord-viewer.js','utf8'),ctx);
const calls=[];
ctx.SongChordViewer.bind({
  openModal:(title,body,opts)=>{modal={title,body,opts}},
  renderVoicings:(symbol,instrument)=>{
    calls.push(`${symbol}:${instrument}`);
    return instrument==='piano'
      ? [{svg:'<svg>P1</svg>'},{svg:'<svg>P2</svg>'},{svg:'<svg>P3</svg>'}]
      : [{svg:'<svg>G1</svg>'},{svg:'<svg>G2</svg>'},{svg:'<svg>G3</svg>'}];
  },
  unavailableText:()=> 'none', previousVoicingText:()=> 'prev', nextVoicingText:()=> 'next',
  guitarText:()=> 'Guitar', pianoText:()=> 'Piano', instrumentText:()=> 'Instrument'
});
root.dispatch('click',{target:chord});
let failed=0;
const check=(ok,msg)=>{console.log(ok?'PASS':'FAIL',msg);if(!ok)failed++;};
check(modal&&modal.title==='Am'&&modal.opts.variant==='chord-viewer'&&modal.body.children.length===3,'popup opens with compact instrument switch + diagram + voicing nav');
const switcher=modal.body.children[0], diagram=modal.body.children[1], nav=modal.body.children[2];
const guitar=switcher.children[0], piano=switcher.children[1];
const prev=nav.children[0], count=nav.children[1], next=nav.children[2];
check(guitar.textContent==='Guitar'&&piano.textContent==='Piano'&&guitar.getAttribute('aria-pressed')==='true'&&piano.getAttribute('aria-pressed')==='false','viewer defaults to Guitar and marks the segmented state correctly');
check(diagram.innerHTML.includes('G1')&&count.textContent==='1 / 3'&&!nav.hidden,'first guitar voicing rendered');
next.dispatch('click');
check(diagram.innerHTML.includes('G2')&&count.textContent==='2 / 3','guitar next arrow cycles voicing');
prev.dispatch('click');
check(diagram.innerHTML.includes('G1')&&count.textContent==='1 / 3','guitar previous arrow cycles back');
piano.dispatch('click');
check(piano.getAttribute('aria-pressed')==='true'&&guitar.getAttribute('aria-pressed')==='false'&&modal.body.className.includes('is-piano'),'switch changes to Piano without reopening the modal');
check(diagram.innerHTML.includes('P1')&&count.textContent==='1 / 3','Piano starts at its first/root voicing and resets the counter');
next.dispatch('click');
check(diagram.innerHTML.includes('P2')&&count.textContent==='2 / 3','same little arrows cycle piano inversions');
check(calls.includes('Am:guitar')&&calls.includes('Am:piano'),'viewer asks the shared renderer for instrument-specific voicings');
if(failed)process.exit(1);
