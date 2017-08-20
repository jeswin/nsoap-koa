import nsoap, { RoutingError } from "nsoap";

const identifierRegex = /^[a-zA-Z_$][a-zA-Z_$0-9]*$/;

function wrapValue(val) {
  return typeof val !== "string"
    ? val
    : val === "true" || val === "false"
      ? val === "true"
      : identifierRegex.test(val) ? `${val}` : JSON.parse(val);
}

function parseDict(dict) {
  return key => {
    if (typeof dict === "function") {
      const result = dict(key);
      if (result.contains) {
        return { value: wrapValue(result.value) };
      }
    } else {
      if (Object.prototype.hasOwnProperty.call(dict, key)) {
        const result = dict[key];
        return { value: wrapValue(result) };
      }
    }
  };
}

function parseHeaders(headers) {
  return parseDict(headers);
}

function parseQuery(query) {
  return parseDict(query);
}

function parseBody(body) {
  return body || {};
}

function parseCookies(cookies) {
  return parseDict(key => {
    const item = cookies.get(key);
    return item
      ? {
          contains: true,
          value: item
        }
      : {
          contains: false
        };
  });
}

function createStreamingCompletionHandler(options, { ctx, next }) {
  return options.onResponseStream
    ? {
        onRoutingError(result) {
          options.onResponseStreamError(ctx, next)(new Error("Server error."));
        },
        onResult(result) {
          options.onResponseStreamEnd(ctx, next)(result);
        },
        onError(error) {
          options.onResponseStreamError(ctx, next)(error);
        }
      }
    : undefined;
}

export default function(app, options = {}) {
  const _urlPrefix = options.urlPrefix || "/";
  const urlPrefix = _urlPrefix.endsWith("/") ? _urlPrefix : `${urlPrefix}/`;

  return async (ctx, next) => {
    const { request, response, req, res } = ctx;
    const { query, path, headers } = request;
    const url = ctx.originalUrl;

    if (path.startsWith(urlPrefix)) {
      const body = options.body ? options.getBody(ctx) : request.body;
      const cookies = options.getCookies
        ? options.getCookies(ctx)
        : ctx.cookies;

      const strippedPath = path.substring(urlPrefix.length);
      const dicts = [
        options.parseHeaders
          ? options.parseHeaders(headers)
          : parseHeaders(headers),
        options.parseQuery ? options.parseQuery(query) : parseQuery(query),
        options.parseBody ? options.parseBody(body) : parseBody(body),
        options.parseCookies
          ? options.parseCookies(cookies)
          : parseCookies(cookies)
      ];

      const createContext = options.createContext || (x => x);
      const context = options.appendContext
        ? createContext({ ctx, isContext: () => true })
        : [];

      let isStreaming = false;
      const streamHandler = options.onResponseStream
        ? val => {
            if (!isStreaming) {
              options.onResponseStreamHeader(ctx, next)(val);
              isStreaming = true;
            } else {
              options.onResponseStream(ctx, next)(val);
            }
          }
        : undefined;

      const streamingCompletionHandler = createStreamingCompletionHandler(
        options,
        { ctx, next }
      );

      try {
        const result = await nsoap(app, strippedPath, dicts, {
          index: options.index || "index",
          prependArgs: options.contextAsFirstArgument,
          args: [context],
          onNextValue: streamHandler,
          useSlash: !!options.useSlash
        });

        if (typeof result === "function") {
          result.apply(undefined, [ctx]);
        } else if (result instanceof RoutingError) {
          if (isStreaming) {
            streamingCompletionHandler.onRoutingError(result);
          } else {
            if (result.type === "NOT_FOUND") {
              ctx.throw(404, "Not found.");
            } else {
              ctx.throw(500, "Server error.");
            }
          }
        } else {
          if (!context.handled) {
            if (isStreaming) {
              streamingCompletionHandler.onResult(result);
            } else {
              ctx.status = 200;
              ctx.body = result;
            }
          }
        }
      } catch (error) {
        if (!context.handled) {
          if (isStreaming) {
            streamingCompletionHandler.onError(error);
          } else {
            ctx.throw(400, error);
          }
        }
      }
    }
  };
}
