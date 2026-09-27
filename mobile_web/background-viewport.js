'use strict';
// Keyboard insets resize the WebView, but must not resize or regenerate the scene.
// Width changes (rotation / split-screen) establish a new scene viewport.
(() => {
 let width=innerWidth, height=innerHeight;
 window.qmBackgroundViewport=()=>{
  if(innerWidth!==width){width=innerWidth;height=innerHeight;}
  height=Math.max(height,innerHeight);
  document.documentElement.style.setProperty('--scene-height',height+'px');
  return {width,height};
 };
 window.qmBackgroundViewport();
})();
