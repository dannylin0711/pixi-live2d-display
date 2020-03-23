import { Loader, LoaderResource } from '@pixi/loaders';
import camelCase from 'lodash/camelCase';

/**
 * Deep clones a JSON object, converting all the property names to camel case.
 * @param value - JSON object.
 * @returns Cloned object.
 */
export function cloneWithCamelCase(value: any): any {
    if (Array.isArray(value)) {
        return value.map(cloneWithCamelCase);
    }

    if (value && typeof value === 'object') {
        const clone: any = {};

        for (const key of Object.keys(value)) {
            clone[camelCase(key)] = cloneWithCamelCase(value[key]);
        }

        return clone;
    }

    return value;
}

export function loadAsync(url: string | string[]): Promise<Partial<Record<string, LoaderResource>>> {
    return new Promise((resolve, reject) => {
        new Loader()
            .add(url)
            .load((loader: Loader, resources: Partial<Record<string, LoaderResource>>) => resolve(resources))
            .on('error', e => reject(e));
    });
}