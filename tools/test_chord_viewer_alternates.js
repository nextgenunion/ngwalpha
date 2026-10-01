const fs=require('fs'),vm=require('vm');
class ClassList {
  constructor(el){this.el=el;this.set=new Set();}
  add(...xs){xs.forEach(x=>this.set.add(x));}
  remove(...xs){xs.forEach(x=>this.set.delete(x));}
  contains(x){return this.set.has(x);}
}
class El {
  constructor(tag='div'){
    this.tagName=tag;this.children=[];this.listeners={};this.dataset={};this.attributes={};
    this.className='';this.textContent='';this._innerHTML='';this.tabIndex=0;this.hidden=false;this.type='';
    this.style={};this.classList=new ClassList(this);this.isConnected=false;this.scrollHeight=0;
  }
  appendChild(x){this.children.push(x);x.isConnected=this.isConnected;return x;}
  append(...xs){xs.forEach(x=>this.appendChild(x));}
  addEventListener(type,fn){(this.listeners[type]||(this.listeners[type]=[])).push(fn);}
  dispatch(type,event={}){for(const fn of this.listeners[type]||[])fn({preventDefault(){},...event});}
  setAttribute(k,v){this.attributes[k]=String(v);}
  getAttribute(k){return this.attributes[k];}
  closest(sel){return this._closest && this._closest(sel);}
  contains(){return true;}
  getBoundingClientRect(){return {height:180,width:300};}
  set innerHTML(v){this._innerHTML=String(v);this.children=[];}
  get innerHTML(){return this._innerHTML;}
}
const root=new El('div'); root.isConnected=true;
const chord=new El('span');chord.dataset.chord='Am';chord.textContent='Am';chord._closest=sel=>sel==='.chord-tag[data-chord]'?chord:null;
let modal=null;
const ctx={console,setTimeout,clearTimeout,document:{getElementById:id=>id==='lyrics-container'?root:null,createElement:tag=>new El(tag)},matchMedia:()=>({matches:true})};ctx.window=ctx;
vm.runInNewContext(fs.readFileSync(__dirname+'/../js/chord-viewer.js','utf8'),ctx);
const calls=[];
ctx.SongChordViewer.bind({
  openModal:(title,body,opts)=>{modal={title,body,opts};body.isConnected=true;body.children.forEach(x=>{x.isConnected=true;x.children.forEach(y=>y.isConnected=true);});},
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
const stage=diagram.children[0];
const guitar=switcher.children[0], piano=switcher.children[1];
const prev=nav.children[0], count=nav.children[1], next=nav.children[2];
check(guitar.textContent==='Guitar'&&piano.textContent==='Piano'&&guitar.getAttribute('aria-pressed')==='true'&&piano.getAttribute('aria-pressed')==='false','viewer defaults to Guitar and marks the segmented state correctly');
check(stage.innerHTML.includes('G1')&&count.textContent==='1 / 3'&&!nav.hidden,'first guitar voicing rendered');
next.dispatch('click');
check(stage.innerHTML.includes('G2')&&count.textContent==='2 / 3','guitar next arrow cycles voicing');
prev.dispatch('click');
check(stage.innerHTML.includes('G1')&&count.textContent==='1 / 3','guitar previous arrow cycles back');
piano.dispatch('click');
check(piano.getAttribute('aria-pressed')==='true'&&guitar.getAttribute('aria-pressed')==='false'&&modal.body.className.includes('is-piano'),'switch changes to Piano without reopening the modal');
check(stage.innerHTML.includes('P1')&&count.textContent==='1 / 3','Piano starts at its first/root voicing and resets the counter');
next.dispatch('click');
check(stage.innerHTML.includes('P2')&&count.textContent==='2 / 3','same little arrows cycle piano inversions');
check(calls.includes('Am:guitar')&&calls.includes('Am:piano'),'viewer asks the shared renderer for instrument-specific voicings');
if(failed)process.exit(1);
