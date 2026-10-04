/**
 * vendor-copy from D:\new-workspace\pu-workbench\qacore\src\run.ts (lines 128-187)
 * source sha256: 13f7b7b1cef61e70fd5296146b4ac540c47ca9130af1685a9ab3f3b447da753a
 * 路由记账模式 + WebSocket 记账 + 容器桥 stub 先例（三注释逐字继承）。
 *
 * NOTE: This snippet depends on surrounding run.ts scope (isLocal, entries,
 * requests, external, blockedUrls, runtimeScripts, isLocalFile, resolve,
 * dirname, artifact, runtimeStubs, CONTAINER_STUB_JS). Foreign-runner will
 * adapt these into its own self-contained route/ws handlers.
 */
    const onRoute = (route: Route): void => {
      const req = route.request();
      let parsed: URL;
      try {
        parsed = new URL(req.url());
      } catch {
        parsed = new URL("about:blank");
      }
      const entry: RequestEntry = {
        url: req.url(),
        method: req.method(),
        resource_type: req.resourceType(),
        status: null,
        blocked: false,
        failed: false,
      };
      entries.set(req, entry);
      requests.push(entry);
      if (!isLocal(parsed)) {
        entry.blocked = true;
        if (!external.includes(req.url())) external.push(req.url());
        blockedUrls.add(req.url());
        void route.abort();
        return;
      }
      // 渠道容器运行时脚本（如 mraid.js）：本地缺失时以桩应答，模拟容器注入。
      // 只对规则库声明过的相对脚本名生效；包体自身的本地 404 照常透传。
      const parts = parsed.pathname.split("/");
      const name = parts[parts.length - 1]!;
      if (runtimeScripts.includes(name) && !isLocalFile(resolve(dirname(artifact), name))) {
        entry.status = 200;
        entry.stub = true;
        if (!runtimeStubs.includes(req.url())) runtimeStubs.push(req.url());
        void route.fulfill({
          status: 200,
          contentType: "application/javascript",
          body: CONTAINER_STUB_JS,
        });
        return;
      }
      void route.continue();
    };

    const onWs = (ws: { url(): string }): void => {
      // WebSocket 不经过 page.route，必须单独拦截。注册 routeWebSocket 后，
      // 未调用 connectToServer 的 socket 不会向服务器发起真实连接（非本机 WS
      // 记账后即被阻于握手前）。注意：不要在处理器里调用 ws.close()——实测会让
      // page.goto 的 load 事件永久挂起，因此非本机 WS 只记账不 close。
      let parsed: URL;
      try {
        parsed = new URL(ws.url());
      } catch {
        parsed = new URL("about:blank");
      }
      if (!isLocal(parsed)) {
        const label = `websocket:${ws.url()}`;
        if (!external.includes(label)) external.push(label);
      }
      // 本地 WS 同样不 connectToServer：静态产物不应依赖 WebSocket。
    };
