(() => {
  const tabs=[...document.querySelectorAll('[role=tab]')];
  const frames=[...document.querySelectorAll('iframe')];
  let selected='streamlined';
  function sync(){frames.forEach(frame=>frame.contentWindow.postMessage({type:'vidsnag:details-design',progress:Number(document.getElementById('progress').value),state:document.getElementById('state').value,active:frame.parentElement.id===`preview-${selected}`},location.origin));document.querySelector('output').textContent=`${document.getElementById('progress').value}%`;}
  function choose(name){selected=name;tabs.forEach(tab=>{const active=tab.dataset.design===name;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;document.getElementById(tab.getAttribute('aria-controls')).hidden=!active;});document.getElementById('standalone').href=`${name}/`;sync();}
  tabs.forEach((tab,index)=>{tab.addEventListener('click',()=>choose(tab.dataset.design));tab.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowLeft'?-1:1)+tabs.length)%tabs.length;choose(tabs[next].dataset.design);tabs[next].focus();});});
  frames.forEach(frame=>frame.addEventListener('load',sync));document.getElementById('progress').addEventListener('input',sync);document.getElementById('state').addEventListener('change',sync);sync();
})();
