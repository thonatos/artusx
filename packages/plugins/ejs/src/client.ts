import fs from 'fs';
import path from 'path';
import ejs, { Options } from 'ejs';
import LRU from 'ylru';

import { ArtusApplication, ArtusInjectEnum, Inject, Injectable, ScopeEnum } from '@artus/core';
import { ArtusXInjectEnum } from './constants';

const contentPattern = '&&<>&&';

function contentFor(contentName: string) {
  return contentPattern + contentName + contentPattern;
}

function parseContents(locals: Locals) {
  let name,
    i = 1,
    str = locals.body,
    regex = new RegExp('\r?\n?' + contentPattern + '.+?' + contentPattern + '\r?\n?', 'g'),
    split = str.split(regex),
    matches = str.match(regex);

  locals.body = split[0];

  if (matches !== null) {
    matches.forEach(function (match) {
      name = match.split(contentPattern)[1];
      locals[name] = split[i];
      i++;
    });
  }
}

function parseScripts(locals: Locals) {
  let str = locals.body,
    regex = /\<script[\s\S]*?\>[\s\S]*?\<\/script\>/g;

  if (regex.test(str)) {
    locals.body = str.replace(regex, '');
    locals.script = str.match(regex).join('\n');
  }
}

function parseStyles(locals: Locals) {
  let str = locals.body,
    regex = /(?:\<style[\s\S]*?\>[\s\S]*?\<\/style\>)|(?:\<link[\s\S]*?\>(?:\<\/link\>)?)/g;

  if (regex.test(str)) {
    locals.body = str.replace(regex, '');
    locals.style = str.match(regex).join('\n');
  }
}

function parseMetas(locals: Locals) {
  let str = locals.body,
    regex = /\<meta[\s\S]*?\>/g;

  if (regex.test(str)) {
    locals.body = str.replace(regex, '');
    locals.meta = str.match(regex).join('\n');
  }
}

type Locals = Record<string, any>;

export type EjsContext = Record<string, any>;

export type EjsConfig = {
  root: string | string[];
  async?: boolean | undefined;
  client?: boolean | undefined;
  options?: Options;
  layout?: Record<string, any>;
};

@Injectable({
  id: ArtusXInjectEnum.EJS,
  scope: ScopeEnum.SINGLETON,
})
export default class EjsClient {
  @Inject(ArtusInjectEnum.Application)
  app: ArtusApplication;

  private defaultConfig: EjsConfig;
  private defaultOptions: Options | undefined;

  private getOptions(options?: Options) {
    const defaultConfig = this.defaultConfig;
    const defaultOptions = this.defaultOptions;

    return {
      ...defaultConfig,
      ...defaultOptions,
      ...options,
    };
  }

  async init(config: EjsConfig) {
    if (!config) {
      return;
    }

    const { options, ...defaultConfig } = config;

    ejs.cache = new LRU(100);
    ejs.fileLoader = (filePath: string) => {
      const _root = defaultConfig.root;

      if (filePath.startsWith('/')) {
        return fs.readFileSync(filePath);
      }

      if (typeof _root === 'string') {
        const target = path.join(_root, filePath);
        return fs.readFileSync(target);
      }

      if (Array.isArray(_root)) {
        const target = _root.find((root: string) => {
          const target = path.join(root, filePath);
          return fs.existsSync(target);
        });

        if (target) {
          return fs.readFileSync(target);
        }
      }

      return fs.readFileSync(filePath);
    };

    this.defaultOptions = options;
    this.defaultConfig = defaultConfig;
  }

  async compile(template: string, options?: Options) {
    return ejs.compile(template, this.getOptions(options));
  }

  async renderFile(template: string, context?: EjsContext) {
    return ejs.renderFile(template, context, this.getOptions());
  }

  async renderString(template: string, context?: EjsContext) {
    return ejs.render(template, context, this.getOptions());
  }

  async render(template: string, context?: EjsContext) {
    const layoutConfig = this.defaultConfig?.layout || {};

    let options: Record<string, any> = {
      layout: context?.layout,
    };

    if (options?.layout === false || (options.layout || layoutConfig?.layout) === false) {
      return this.renderFile(template, context);
    }

    let layout = options.layout || layoutConfig?.layout;

    if (layout === true || layout === undefined) {
      layout = 'layout.ejs';
    }

    const _locals = context?.locals || {};
    const _context = {
      _locals,
      ..._locals,
      ...context,
    };

    // render view
    let str = await this.renderFile(template, {
      ..._context,
      contentFor,
    });

    let l: any;
    let locals = {
      ..._context,
      body: str,
      contentFor,
      defineContent: (contentName: string) => {
        return locals[contentName] || '';
      },
    };

    for (l in options) {
      if (options.hasOwnProperty(l) && l !== 'layout' && l !== 'contentFor') {
        locals[l] = options[l];
      }
    }

    if (typeof locals.body !== 'string') {
      return this.renderFile(template, locals);
    }

    if (
      options.extractScripts === true ||
      (options.extractScripts === undefined && layoutConfig['layout extractScripts'] === true)
    ) {
      locals.script = '';
      parseScripts(locals);
    }

    if (
      options.extractStyles === true ||
      (options.extractStyles === undefined && layoutConfig['layout extractStyles'] === true)
    ) {
      locals.style = '';
      parseStyles(locals);
    }

    if (
      options.extractMetas === true ||
      (options.extractMetas === undefined && layoutConfig['layout extractMetas'] === true)
    ) {
      locals.meta = '';
      parseMetas(locals);
    }

    parseContents(locals);

    // render layout
    return this.renderFile(layout, locals);
  }
}

export { EjsClient };
