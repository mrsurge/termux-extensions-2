const o="<<<RPC>>> ",t="<<<PUSH>>> ";function i(r,n,e){return{jsonrpc:"2.0",id:r,error:{code:n,message:e}}}function s(r){if(!r.trim())return{ok:!1};try{return{ok:!0,value:JSON.parse(r)}}catch{return{ok:!1,errorReply:i(null,-32700,"Parse error")}}}function u(r){return`${o}${JSON.stringify(r)}
`}function p(r){return`${t}${JSON.stringify(r)}
`}function c(r){return`${JSON.stringify(r)}
`}export{t as PUSH_PREFIX,o as RPC_PREFIX,i as buildJsonRpcErrorReply,p as encodePushLine,u as encodeRpcReplyLine,c as encodeStartupBeaconLine,s as parseStdioJsonLine};
