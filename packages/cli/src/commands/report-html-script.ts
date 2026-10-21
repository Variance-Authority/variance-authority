/**
 * The comparison itself: a wipe, a blend, a blink and a region overlay.
 *
 * Split from the elements for size, and kept as one string because it is one
 * program. Nothing in it fetches and nothing in it decides anything about the
 * run — every number on the page is in the artifact before this runs.
 */

export const SCRIPT = `
(function(){
var $=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))};

/* A carried picture: base64 in an element nothing runs, turned into a blob: URL
   for every image that names it, and the text dropped so it is held once.
   Turned when an image naming it comes near the screen, not when it arrives:
   decoding every picture at load is the cost the page exists to avoid. An
   image hidden by its view does not intersect, so a view's pictures are
   turned when the reviewer opens it. */
var wanted={}, turned={};
var turn=function(n){
  if(turned[n]) return;
  var el=document.getElementById('picture-'+n); if(!el){wanted[n]=true; return}
  turned[n]=true;
  var b64=el.textContent, bytes;
  if(Uint8Array.fromBase64) bytes=Uint8Array.fromBase64(b64);
  else{var raw=atob(b64); bytes=new Uint8Array(raw.length); for(var i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i)}
  var url=URL.createObjectURL(new Blob([bytes],{type:el.getAttribute('data-media')||''}));
  el.remove();
  $('img[data-picture="'+n+'"]').forEach(function(img){img.src=url});
};
var near=typeof IntersectionObserver==='function'?new IntersectionObserver(function(seen){
  seen.forEach(function(e){
    if(!e.isIntersecting) return;
    near.unobserve(e.target); turn(e.target.getAttribute('data-picture'));
  });
},{rootMargin:'100% 0px'}):null;
$('img[data-picture]').forEach(function(img){if(near) near.observe(img)});
/* Called as each picture arrives; without an observer every picture is turned. */
window.variancePicture=function(n){if(!near||wanted[n]) turn(String(n))};

/* Region overlay. The natural size is the raster's size, so boxes scale with the
   rendered image and never need a width the report does not carry. */
$('.subject').forEach(function(card){
  var stage=card.querySelector('.stage'); if(!stage) return;
  var boxes=stage.querySelector('.boxes'), rows=$('tr[data-region]',card);
  /* The row asked for before its box was drawn. A subject that opens on the
     change has never loaded the full page, so the box is shown when the image
     it is drawn on arrives. */
  var asked=null, marked=null;
  var show=function(i){
    var b=boxes&&boxes.querySelector('b[data-for="'+i+'"]'); if(!b){asked=i; return}
    asked=null; marked=i;
    b.scrollIntoView({block:'center',inline:'nearest'});
    $('b.asked',boxes).forEach(function(o){o.classList.remove('asked')}); b.classList.add('asked');
  };
  var img=stage.querySelector('.after')||stage.querySelector('.before');
  if(boxes&&img&&rows.length){
    var paint=function(){
      if(!img.naturalWidth) return;
      boxes.style.width=img.clientWidth+'px'; boxes.style.height=img.clientHeight+'px';
      boxes.innerHTML='';
      rows.forEach(function(row,i){
        var d=row.getAttribute('data-box'); if(!d) return;
        var p=d.split(',').map(Number), b=document.createElement('b');
        b.setAttribute('data-for',i);
        b.style.left=(p[0]/img.naturalWidth*100)+'%'; b.style.top=(p[1]/img.naturalHeight*100)+'%';
        b.style.width=(p[2]/img.naturalWidth*100)+'%'; b.style.height=(p[3]/img.naturalHeight*100)+'%';
        if(!row.classList.contains('cause')) b.className='collateral';
        if(i===marked) b.classList.add('asked');
        b.addEventListener('mouseenter',function(){b.classList.add('on');row.classList.add('on')});
        b.addEventListener('mouseleave',function(){b.classList.remove('on');row.classList.remove('on')});
        row.addEventListener('mouseenter',function(){b.classList.add('on')});
        row.addEventListener('mouseleave',function(){b.classList.remove('on')});
        boxes.appendChild(b);
      });
      if(asked!==null) show(asked);
    };
    /* Listened for even when complete: a carried picture has no source until
       its payload arrives, and an image with no source reports complete. */
    img.addEventListener('load',paint); if(img.complete) paint();
    addEventListener('resize',paint);
  }

  var setMode=function(mode){
    stage.setAttribute('data-mode',mode);
    /* A lazy image hidden when the page loaded is not looked at again when it
       is shown, so a view the reviewer chose loads its pictures now. */
    if(mode!=='change') $('img[loading=lazy]',stage).forEach(function(i){i.loading='eager'});
    $('.modes button',card).forEach(function(b){
      b.classList.toggle('on',b.getAttribute('data-mode')===mode)});
    var blend=card.querySelector('.blend');
    if(blend) blend.style.display=(mode==='blend')?'block':'none';
    if(mode==='regions'&&boxes&&!boxes.childElementCount&&img&&img.complete) img.dispatchEvent(new Event('load'));
  };
  $('.modes button',card).forEach(function(b){
    b.addEventListener('click',function(){setMode(b.getAttribute('data-mode'))})});
  var blend=card.querySelector('.blend');
  if(blend){blend.addEventListener('input',function(){
    stage.style.setProperty('--blend',blend.value/100)})}
  card.setMode=setMode;

  /* A row names a box the reviewer may not be looking at: on a tall page it is
     below the fold of the stage. Clicking the row shows it there. */
  rows.forEach(function(row,i){
    if(!boxes||!row.getAttribute('data-box')) return;
    var open=function(){
      if(stage.getAttribute('data-mode')!=='regions'&&card.querySelector('.modes button[data-mode=regions]')) setMode('regions');
      show(i);
    };
    row.tabIndex=0;
    row.addEventListener('click',function(e){
      if(e.target.closest&&e.target.closest('[data-copy]')) return;
      open();
    });
    row.addEventListener('keydown',function(e){
      if(e.target!==row||(e.key!=='Enter'&&e.key!==' ')) return;
      e.preventDefault(); open();
    });
  });
  var initial=card.querySelector('.modes button');
  if(initial) setMode(initial.getAttribute('data-mode'));

  /* Wipe follows the pointer rather than a slider: the reviewer is already
     pointing at the part they doubt. */
  var drag=function(e){
    if(stage.getAttribute('data-mode')!=='wipe') return;
    var target=stage.querySelector('.after')||stage;
    var r=target.getBoundingClientRect();
    if(!r.width) return;
    var n=Math.min(1,Math.max(0,(e.clientX-r.left)/r.width));
    stage.style.setProperty('--wipe',(n*100)+'%'); stage.style.setProperty('--wipe-n',n);
  };
  stage.addEventListener('pointermove',drag);
});

/* One filter over the rail and the pane. A cause is a filter, not a link. */
var input=document.getElementById('filter'), causes=$('button.cause'), keys=$('.key');
var pinned=null, verdict=null;
/* Rail rows, subject cards and ledger entries are one population: everything that
   names a subject. Two loops over two selectors is how the census bar came to have
   four segments that filtered nothing — a third kind of element was added and the
   filter did not know about it. The quiet class is the settled and unobserved
   half: on the page, folded away until somebody asks for it. */
var apply=function(){
  var q=(input&&input.value||'').toLowerCase();
  var asked=!!(q||pinned||verdict);
  $('[data-subject]').forEach(function(el){
    var id=el.getAttribute('data-subject')||'';
    var hit=(!q||id.toLowerCase().indexOf(q)>=0)
      &&(!pinned||pinned.indexOf(id)>=0)
      &&(!verdict||el.getAttribute('data-verdict')===verdict)
      &&(asked||!el.classList.contains('quiet'));
    el.classList.toggle('hidden',!hit);
  });
  /* A section holding nothing the filter kept is closed rather than left as a
     heading over nothing, which reads as an answer of none. */
  $('section').forEach(function(sec){
    var items=$('[data-subject]',sec);
    if(items.length){
      sec.classList.toggle('hidden',!items.some(function(el){
        return !el.classList.contains('hidden')}));
      return;
    }
    var holds=sec.getAttribute('data-holds');
    if(holds) sec.classList.toggle('hidden',!!verdict&&holds.split(' ').indexOf(verdict)<0);
  });
};
if(input) input.addEventListener('input',apply);
causes.forEach(function(button){
  button.addEventListener('click',function(){
    var on=button.getAttribute('aria-pressed')==='true';
    causes.forEach(function(b){b.setAttribute('aria-pressed','false')});
    button.setAttribute('aria-pressed',on?'false':'true');
    pinned=on?null:(button.getAttribute('data-subjects')||'').split(' ');
    apply();
  });
});
keys.forEach(function(button){
  button.addEventListener('click',function(){
    var name=button.getAttribute('data-filter');
    var on=button.getAttribute('aria-pressed')==='true';
    keys.forEach(function(b){b.setAttribute('aria-pressed','false')});
    button.setAttribute('aria-pressed',on?'false':'true');
    verdict=on?null:name; apply();
    var seat=document.getElementById(name==='failed'||name==='excluded'||name==='unreached'?'Not-observed':
      (name==='unchanged'||name==='ignored')?'Settled':'');
    if(!on&&seat&&!seat.classList.contains('hidden')) seat.scrollIntoView({block:'start'});
  });
});
apply();

/* Copy, everywhere a value is worth taking away from the page. */
document.addEventListener('click',function(e){
  var b=e.target.closest&&e.target.closest('[data-copy]'); if(!b) return;
  var v=b.getAttribute('data-copy');
  var done=function(){b.classList.add('copied');setTimeout(function(){b.classList.remove('copied')},900)};
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(v).then(done,done)}
  else{var t=document.createElement('textarea');t.value=v;document.body.appendChild(t);t.select();
    try{document.execCommand('copy')}catch(_){} t.remove(); done()}
});

/* Keys, because this page is opened every day. */
var at=-1;
var cards=function(){return $('.subject').filter(function(c){return !c.classList.contains('hidden')})};
var go=function(step){
  var list=cards(); if(!list.length) return;
  at=Math.min(list.length-1,Math.max(0,at+step));
  $('.subject').forEach(function(c){c.classList.remove('on')});
  list[at].classList.add('on'); list[at].scrollIntoView({block:'start',behavior:'smooth'});
};
addEventListener('keydown',function(e){
  if(e.target&&(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA')){
    if(e.key==='Escape'){e.target.blur()} return}
  if(e.metaKey||e.ctrlKey||e.altKey) return;
  if(e.key==='j'){e.preventDefault();go(1)}
  else if(e.key==='k'){e.preventDefault();go(-1)}
  else if(e.key==='/'){e.preventDefault();if(input)input.focus()}
  else if(e.key>='1'&&e.key<='9'){
    var list=cards(), card=list[at]||list[0]; if(!card) return;
    var button=$('.modes button',card)[Number(e.key)-1];
    if(button&&card.setMode){e.preventDefault();card.setMode(button.getAttribute('data-mode'))}
  }
});
})();
`;
