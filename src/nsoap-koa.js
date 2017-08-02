import nsoap from "nsoap";

const identifierRegex = /^[a-zA-Z_$][a-zA-Z_$0-9]*$/;

function parseHeaders(headers) {
  return headers;
}

function parseQuery(query) {
  return Object.keys(query).reduce((acc, key) => {
    const val = query[key];
    acc[key] =
      val === "true" || val === "false"
        ? val === "true"
        : identifierRegex.test(val) ? `${val}` : JSON.parse(val);
    return acc;
  }, {});
}

function parseBody(body) {
  return body;
}

export default function(app, options = {}) {
  const _urlPrefix = options.urlPrefix || "/";
  const urlPrefix = _urlPrefix.endsWith("/") ? _urlPrefix : `${urlPrefix}/`;

  return async ctx => {
    const { request, response, req, res } = ctx;
    const url = ctx.originalUrl;
    const { query, path, headers } = request;
    const body = options.body ? options.body(ctx) : request.body;
    if (path.startsWith(urlPrefix)) {
      const strippedPath = path.substring(urlPrefix.length);
      const dicts = [
        options.parseHeaders
          ? options.parseHeaders(headers)
          : parseHeaders(headers),
        options.parseQuery ? options.parseQuery(query) : parseQuery(query),
        options.parseBody ? options.parseBody(body) : parseBody(body)
      ];

      const context = options.createContext
        ? options.createContext({ ctx, isContext: () => true })
        : { ctx, isContext: () => true };

      try {
        const result = await nsoap(app, strippedPath, dicts, {
          index: options.index || "index",
          prependArgs: options.contextAsFirstArgument,
          args: [context]
        });

        if (!context.handled) {
          ctx.status = 200;
          ctx.body = result;
        }
      } catch (error) {
        if (!context.handled) {
          ctx.throw(400, error);
        }
      }
    }
  };
}
