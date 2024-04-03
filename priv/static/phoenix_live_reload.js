//
// Patch this file to enable HMR; Hot Module Reloading for other asset types
//

//
// Patched functions begin
//

let jsStrategy = (chan, msg) => {
  console.info("[HMR] JS file updated", msg);
  // HACK When a JS file updated, we search for corresponding <script> tag with [data-hmr] attribute.
  // If found, we try HMR (via doHMR() function), otherwise reload the page.
  let hmrTargetQuery = `script[src*='${msg.path}'][data-hmr]`
  if (
    window.parent.document.querySelector(hmrTargetQuery) &&
    window.parent.doHMR
  ) {
    console.info(`[HMR] Initiating HMR... (${msg.path})`)
    // Migrated from https://github.com/klazuka/elm-hot/blob/master/test/client.js
    let hmrTargetReq = new Request(msg.path)
    hmrTargetReq.cache = "no-cache"
    fetch(hmrTargetReq).then((res) => {
      if (res.ok) {
        res.text().then((newModule) => {
          window.parent.doHMR(newModule)
          console.info(`[HMR] Done! (${msg.path})`)
        });
      } else {
        // Debug here
        console.error(`[HMR] Fetch failed (${msg.path}):`, res.statusText)
      }
    })
  } else {
    console.info(`[HMR] Not-applicable. Reloading page... (${msg.path})`)
    window.top.location.reload()
  }
}

//
// Patched functions end
//

let buildFreshUrl = (link) => {
  let date = Math.round(Date.now() / 1000).toString()
  let url = link.href.replace(/(\&|\\?)vsn=\d*/, "")
  let newLink = document.createElement('link')
  let onComplete = () => {
    if(link.parentNode !== null){
      link.parentNode.removeChild(link)
    }
  }

  newLink.onerror = onComplete
  newLink.onload  = onComplete
  link.setAttribute("data-pending-removal", "")
  newLink.setAttribute("rel", "stylesheet");
  newLink.setAttribute("type", "text/css");
  newLink.setAttribute("href", url + (url.indexOf("?") >= 0 ? "&" : "?") + "vsn=" + date)
  link.parentNode.insertBefore(newLink, link.nextSibling)
  return newLink
}

let repaint = () => {
  let browser = navigator.userAgent.toLowerCase()
  if(browser.indexOf("chrome") > -1){
    setTimeout(() => document.body.offsetHeight, 25)
  }
}

let cssStrategy = () => {
  let reloadableLinkElements = window.parent.document.querySelectorAll(
    "link[rel=stylesheet]:not([data-no-reload]):not([data-pending-removal])"
  )

  Array.from(reloadableLinkElements)
    .filter(link => link.href)
    .forEach(link => buildFreshUrl(link))

  repaint()
}

let pageStrategy = channel => {
  channel.off("assets_change")
  window[targetWindow].location.reload()
}

let reloadStrategies = {
  js: jsStrategy,
  css: reloadPageOnCssChanges ? pageStrategy : cssStrategy,
  page: pageStrategy
};

class LiveReloader {
  constructor(socket){
    this.socket = socket
    this.logsEnabled = false
    this.enabledOnce = false
    this.editorURL = null
  }
  enable(){
    this.socket.onOpen(() => {
      if(this.enabledOnce){ return }
      this.enabledOnce = true
      if(["complete", "loaded", "interactive"].indexOf(parent.document.readyState) >= 0){
        this.dispatchConnected()
      } else {
        parent.addEventListener("load", () => this.dispatchConnected())
      }
    })

    this.channel = socket.channel("phoenix:live_reload", {})
    this.channel.on("assets_change", msg => {
      let reloadStrategy = reloadStrategies[msg.asset_type] || reloadStrategies.page
      setTimeout(() => reloadStrategy(this.channel, msg), interval)
    })
    this.channel.on("log", ({msg, level}) => this.logsEnabled && this.log(level, msg))
    this.channel.join().receive("ok", ({editor_url}) => {
      this.editorURL = editor_url
    })
    this.socket.connect()
  }

  disable(){
    this.channel.leave()
    socket.disconnect()
  }

  enableServerLogs(){ this.logsEnabled = true }
  disableServerLogs(){ this.logsEnabled = false }

  openEditorAtCaller(targetNode){
    if(!this.editorURL){
      return console.error("phoenix_live_reload cannot openEditorAtCaller without configured PLUG_EDITOR")
    }

    let fileLineApp = this.closestCallerFileLine(targetNode)
    if(fileLineApp){
      this.openFullPath(...fileLineApp)
    }
  }

  openEditorAtDef(targetNode){
    if(!this.editorURL){
      return console.error("phoenix_live_reload cannot openEditorAtDef without configured PLUG_EDITOR")
    }

    let fileLineApp = this.closestDefFileLine(targetNode)
    if(fileLineApp){
      this.openFullPath(...fileLineApp)
    }
  }

  // private

  openFullPath(file, line, app){
    console.log("opening full path", file, line, app)
    this.channel.push("full_path", {rel_path: file, app: app})
      .receive("ok", ({full_path}) => {
        console.log("full path", full_path)
        let url = this.editorURL.replace("__FILE__", full_path).replace("__LINE__", line)
        window.open(url, "_self")
      })
      .receive("error", reason => console.error("failed to resolve full path", reason))
  }

  dispatchConnected(){
    parent.dispatchEvent(new CustomEvent("phx:live_reload:attached", {detail: this}))
  }

  log(level, str){
    let levelColor = level === "debug" ? "darkcyan" : "inherit"
    let consoleFunc = level === "error" ? level : "log"
    console[consoleFunc](`%c📡 ${str}`, `color: ${levelColor};`)
  }

  closestCallerFileLine(node){
    while(node.previousSibling){
      node = node.previousSibling
      if(node.nodeType === Node.COMMENT_NODE){
        let callerComment = node.previousSibling
        let callerMatch = callerComment &&
          callerComment.nodeType === Node.COMMENT_NODE &&
          callerComment.nodeValue.match(/\s@caller\s+(.+):(\d+)\s\((.*)\)\s/i)

        if(callerMatch){
          return [callerMatch[1], callerMatch[2], callerMatch[3]]
        }
      }
    }
    if(node.parentNode){ return this.closestCallerFileLine(node.parentNode) }
  }

  closestDefFileLine(node){
    while(node.previousSibling){
      node = node.previousSibling
      if(node.nodeType === Node.COMMENT_NODE){
        let fcMatch = node.nodeValue.match(/.*>\s([\w\/]+.*ex):(\d+)\s\((.*)\)\s/i)
        if(fcMatch){
          return [fcMatch[1], fcMatch[2], fcMatch[3]]
        }
      }
    }
    if(node.parentNode){ return this.closestDefFileLine(node.parentNode) }
  }
}

reloader = new LiveReloader(socket)
reloader.enable()
