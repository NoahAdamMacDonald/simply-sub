// The production build's version, defined by apps/web/scripts/build.mjs as strings (an object would be hoisted into
// the initial bundle); a development build has none.
declare const ngAppCommit: string | undefined;
declare const ngAppBuiltOn: string | undefined;

export interface AppVersion {
  /** The commit it was built from, cut to 7 digits, when the build could tell. */
  commit?: string;
  /** The day it was built, an ISO date. */
  builtOn: string;
}

/** This build's version (PROJECT-PLAN M10.6), for Settings; undefined in a development build. */
export const appVersion: AppVersion | undefined =
  typeof ngAppBuiltOn === 'undefined'
    ? undefined
    : { builtOn: ngAppBuiltOn, ...(typeof ngAppCommit === 'string' && { commit: ngAppCommit }) };
