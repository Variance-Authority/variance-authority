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

/* Region overlay. The natural size is the raster's size, so boxes scale with the
   rendered image and never need a width the report does not carry. */
$('.subject').forEach(function(card){
  var stage=card.querySelector('.stage'); if(!stage) return;
  var boxes=stage.querySelector('.boxes'), rows=$('tr[data-region]',card);
  var img=stage.querySelector('.after')||stage.querySelector('.before');
  if(boxes&&img&&rows.length){
    var paint=function(){
      if(!img.naturalWidth) return;
      boxes.style.width=img.clientWidth+'px'; boxes.style.height=img.clientHeight+'px';
      boxes.innerHTML='';
      rows.forEach(function(row,i){
        var d=row.getAttribute('data-box'); if(!d) return;
        var p=d.split(',').map(Number), b=document.createElement('b');
        b.style.left=(p[0]/img.naturalWidth*100)+'%'; b.style.top=(p[1]/img.naturalHeight*100)+'%';
        b.style.width=(p[2]/img.naturalWidth*100)+'%'; b.style.height=(p[3]/img.naturalHeight*100)+'%';
        if(!row.classList.contains('cause')) b.className='collateral';
        b.addEventListener('mouseenter',function(){b.classList.add('on');row.classList.add('on')});
        b.addEventListener('mouseleave',function(){b.classList.remove('on');row.classList.remove('on')});
        row.addEventListener('mouseenter',function(){b.classList.add('on')});
        row.addEventListener('mouseleave',function(){b.classList.remove('on')});
        boxes.appendChild(b);
      });
    };
    img.complete?paint():img.addEventListener('load',paint);
    addEventListener('resize',paint);
  }

  var setMode=function(mode){
    stage.setAttribute('data-mode',mode);
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
var input=document.getElementById('filter'), causes=$('.cause'), keys=$('.key');
var pinned=null, verdict=null;
var apply=function(){
  var q=(input&&input.value||'').toLowerCase();
  $('.row').forEach(function(row){
    var id=row.getAttribute('data-subject')||'';
    var hit=(!q||id.toLowerCase().indexOf(q)>=0)
      &&(!pinned||pinned.indexOf(id)>=0)
      &&(!verdict||row.getAttribute('data-verdict')===verdict);
    row.classList.toggle('hidden',!hit);
  });
  $('.subject').forEach(function(card){
    var id=card.getAttribute('data-subject')||'';
    var hit=(!q||id.toLowerCase().indexOf(q)>=0)
      &&(!pinned||pinned.indexOf(id)>=0)
      &&(!verdict||card.getAttribute('data-verdict')===verdict);
    card.classList.toggle('hidden',!hit);
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
  });
});

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
  else if(e.key>='1'&&e.key<='5'){
    var list=cards(), card=list[at]||list[0]; if(!card) return;
    var button=$('.modes button',card)[Number(e.key)-1];
    if(button&&card.setMode){e.preventDefault();card.setMode(button.getAttribute('data-mode'))}
  }
});
})();
`;
