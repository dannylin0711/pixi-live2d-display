import type { InternalModel, ModelSettings, MotionPriority } from "@/cubism-common";
import type { MotionManagerOptions } from "@/cubism-common/MotionManager";
import type { Live2DFactoryOptions } from "@/factory/Live2DFactory";
import { Live2DFactory } from "@/factory/Live2DFactory";
import type { Rectangle, Renderer, Texture, Ticker, Observer } from "pixi.js";
import { Matrix, ObservablePoint, Point, RenderContainer, WebGPURenderer } from "pixi.js";
import { Container } from "pixi.js";
import { Automator, type AutomatorOptions } from "./Automator";
import { Live2DTransform } from "./Live2DTransform";
import type { JSONObject } from "./types/helpers";
import { logger } from "./utils";

export interface Live2DModelOptions extends MotionManagerOptions, AutomatorOptions {}

const tempPoint = new Point();
const tempMatrix = new Matrix();

export type Live2DConstructor = { new (options?: Live2DModelOptions): Live2DModel };

/**
 * A wrapper that allows the Live2D model to be used as a DisplayObject in PixiJS.
 *
 * ```js
 * const model = await Live2DModel.from('shizuku.model.json');
 * container.add(model);
 * ```
 * @emits {@link Live2DModelEvents}
 */
export class Live2DModel<IM extends InternalModel = InternalModel> extends RenderContainer {
    Live2DModelObserver = class implements Observer<ObservablePoint> {
        parent: Live2DModel;
        _onUpdate: (point?: ObservablePoint | undefined) => void;

        constructor(parent: Live2DModel) {
            this.parent = parent;
            this._onUpdate = parent.onAnchorChange.bind(parent);
        }
    }

    /**
     * Creates a Live2DModel from given source.
     * @param source - Can be one of: settings file URL, settings JSON object, ModelSettings instance.
     * @param options - Options for the creation.
     * @return Promise that resolves with the Live2DModel.
     */
    static from<M extends Live2DConstructor = typeof Live2DModel>(
        this: M,
        source: string | JSONObject | ModelSettings,
        options?: Live2DFactoryOptions,
    ): Promise<InstanceType<M>> {
        const model = new this(options) as InstanceType<M>;

        return Live2DFactory.setupLive2DModel(model, source, options).then(() => model);
    }

    /**
     * Synchronous version of `Live2DModel.from()`. This method immediately returns a Live2DModel instance,
     * whose resources have not been loaded. Therefore this model can't be manipulated or rendered
     * until the "load" event has been emitted.
     *
     * ```js
     * // no `await` here as it's not a Promise
     * const model = Live2DModel.fromSync('shizuku.model.json');
     *
     * // these will cause errors!
     * // app.stage.addChild(model);
     * // model.motion('tap_body');
     *
     * model.once('load', () => {
     *     // now it's safe
     *     app.stage.addChild(model);
     *     model.motion('tap_body');
     * });
     * ```
     */
    static fromSync<M extends Live2DConstructor = typeof Live2DModel>(
        this: M,
        source: string | JSONObject | ModelSettings,
        options?: Live2DFactoryOptions,
    ): InstanceType<M> {
        const model = new this(options) as InstanceType<M>;

        Live2DFactory.setupLive2DModel(model, source, options)
            .then(options?.onLoad)
            .catch(options?.onError);

        return model;
    }

    /**
     * Registers the class of `PIXI.Ticker` for auto updating.
     * @deprecated Use {@link Live2DModelOptions.ticker} instead.
     */
    static registerTicker(tickerClass: typeof Ticker): void {
        Automator["defaultTicker"] = tickerClass.shared;
    }

    /**
     * Tag for logging.
     */
    tag = "Live2DModel(uninitialized)";

    /**
     * The internal model. Though typed as non-nullable, it'll be undefined until the "ready" event is emitted.
     */
    internalModel!: IM;

    /**
     * Pixi textures.
     */
    textures: Texture[] = [];

    /** @override */
    transform = new Live2DTransform();

    /**
     * The anchor behaves like the one in `PIXI.Sprite`, where `(0, 0)` means the top left
     * and `(1, 1)` means the bottom right.
     */

    anchor = new ObservablePoint(new this.Live2DModelObserver(this), 0, 0) as ObservablePoint; // cast the type because it breaks the casting of Live2DModel

    /**
     * An ID of Gl context that syncs with `renderer.CONTEXT_UID`. Used to check if the GL context has changed.
     */
    protected glContextID = -1;

    /**
     * Elapsed time in milliseconds since created.
     */
    elapsedTime: DOMHighResTimeStamp = 0;

    /**
     * Elapsed time in milliseconds from last frame to this frame.
     */
    deltaTime: DOMHighResTimeStamp = 0;

    automator: Automator;

    constructor(options: Live2DModelOptions = {}) {
        super(options as any);

        this.automator = new Automator(this, options);

        this.once("modelLoaded", () => this.init(options));
    }

    // TODO: rename
    /**
     * A handler of the "modelLoaded" event, invoked when the internal model has been loaded.
     */
    protected init(options?: Live2DModelOptions) {
        this.tag = `Live2DModel(${this.internalModel.settings.name})`;
    }

    /**
     * A callback that observes {@link anchor}, invoked when the anchor's values have been changed.
     */
    protected onAnchorChange(): void {
        this.pivot.set(
            this.anchor.x * this.internalModel.width,
            this.anchor.y * this.internalModel.height,
        );
    }

    /**
     * Shorthand to start a motion.
     * @param group - The motion group.
     * @param index - The index in this group. If not presented, a random motion will be started.
     * @param priority - The motion priority. Defaults to `MotionPriority.NORMAL`.
     * @return Promise that resolves with true if the motion is successfully started, with false otherwise.
     */
    motion(group: string, index?: number, priority?: MotionPriority): Promise<boolean> {
        return index === undefined
            ? this.internalModel.motionManager.startRandomMotion(group, priority)
            : this.internalModel.motionManager.startMotion(group, index, priority);
    }

    /**
     * Shorthand to set an expression.
     * @param id - Either the index, or the name of the expression. If not presented, a random expression will be set.
     * @return Promise that resolves with true if succeeded, with false otherwise.
     */
    expression(id?: number | string): Promise<boolean> {
        if (this.internalModel.motionManager.expressionManager) {
            return id === undefined
                ? this.internalModel.motionManager.expressionManager.setRandomExpression()
                : this.internalModel.motionManager.expressionManager.setExpression(id);
        }
        return Promise.resolve(false);
    }

    /**
     * Updates the focus position. This will not cause the model to immediately look at the position,
     * instead the movement will be interpolated.
     * @param x - Position in world space.
     * @param y - Position in world space.
     * @param instant - Should the focus position be instantly applied.
     */
    focus(x: number, y: number, instant: boolean = false): void {
        tempPoint.x = x;
        tempPoint.y = y;

        // we can pass `true` as the third argument to skip the update transform
        // because focus won't take effect until the model is rendered,
        // and a model being rendered will always get transform updated
        this.toModelPosition(tempPoint, tempPoint, true);

        const tx = (tempPoint.x / this.internalModel.originalWidth) * 2 - 1;
        const ty = (tempPoint.y / this.internalModel.originalHeight) * 2 - 1;
        const radian = Math.atan2(ty, tx);
        this.internalModel.focusController.focus(Math.cos(radian), -Math.sin(radian), instant);
    }

    /**
     * Tap on the model. This will perform a hit-testing, and emit a "hit" event
     * if at least one of the hit areas is hit.
     * @param x - Position in world space.
     * @param y - Position in world space.
     * @emits {@link Live2DModelEvents.hit}
     */
    tap(x: number, y: number): void {
        const hitAreaNames = this.hitTest(x, y);

        if (hitAreaNames.length) {
            logger.log(this.tag, `Hit`, hitAreaNames);

            this.emit("hit", hitAreaNames);
        }
    }

    /**
     * Hit-test on the model.
     * @param x - Position in world space.
     * @param y - Position in world space.
     * @return The names of the *hit* hit areas. Can be empty if none is hit.
     */
    hitTest(x: number, y: number): string[] {
        tempPoint.x = x;
        tempPoint.y = y;
        this.toModelPosition(tempPoint, tempPoint);

        return this.internalModel.hitTest(tempPoint.x, tempPoint.y);
    }

    /**
     * Calculates the position in the canvas of original, unscaled Live2D model.
     * @param position - A Point in world space.
     * @param result - A Point to store the new value. Defaults to a new Point.
     * @param skipUpdate - True to skip the update transform.
     * @return The Point in model canvas space.
     */
    toModelPosition(
        position: Point,
        result: Point = position.clone(),
        skipUpdate?: boolean,
    ): Point {
        // if (!skipUpdate) {
        //     this._recursivePostUpdateTransform();

        //     if (!this.parent) {
        //         (this.parent as any) = this._tempDisplayObjectParent;
        //         this.displayObjectUpdateTransform();
        //         (this.parent as any) = null;
        //     } else {
        //         this.displayObjectUpdateTransform();
        //     }
        // }

        // this.transform.worldTransform.applyInverse(position, result);
        this.internalModel.localTransform.applyInverse(result, result);

        return result;
    }

    /**
     * A method required by `PIXI.InteractionManager` to perform hit-testing.
     * @param point - A Point in world space.
     * @return True if the point is inside this model.
     */
    containsPoint = (point: Point): boolean => {
        return this.getBounds(true).rectangle.contains(point.x, point.y);
    }

    /** @override */
    protected _calculateBounds(): void {
        this.bounds.addFrame(0, 0, this.internalModel.width, this.internalModel.height);
    }

    /**
     * Updates the model. Note this method just updates the timer,
     * and the actual update will be done right before rendering the model.
     * @param dt - The elapsed time in milliseconds since last frame.
     */
    update(dt: DOMHighResTimeStamp): void {
        this.deltaTime += dt;
        this.elapsedTime += dt;

        // don't call `this.internalModel.update()` here, because it requires WebGL context
    }

    override render(renderer: Renderer): void {
        if (renderer instanceof WebGPURenderer) {
            throw "Only support WebGLRenderer for now.";
        }

        // reset certain systems in renderer to make Live2D's drawing system compatible with Pixi
        // TODO: need fix here
        // renderer.batch.reset();
        renderer.geometry.reset();
        // renderer.shader.reset();
        renderer.state.reset();

        let shouldUpdateTexture = false;

        // when the WebGL context has changed
        if (this.glContextID !== (renderer as any).CONTEXT_UID) {
            this.glContextID = (renderer as any).CONTEXT_UID;

            this.internalModel.updateWebGLContext(renderer.gl, this.glContextID);

            shouldUpdateTexture = true;
        }

        for (let i = 0; i < this.textures.length; i++) {
            const texture = this.textures[i]!;

            if (!texture.baseTexture.resource.valid) {
                continue;
            }

            if (
                shouldUpdateTexture ||
                !(texture.baseTexture as any)._glTextures[this.glContextID]
            ) {
                renderer.gl.pixelStorei(
                    WebGLRenderingContext.UNPACK_FLIP_Y_WEBGL,
                    this.internalModel.textureFlipY,
                );

                // let the TextureSystem generate corresponding WebGLTexture, and bind to an arbitrary location
                renderer.texture.bind(texture.baseTexture, 0);
            }

            // bind the WebGLTexture into Live2D core.
            // because the Texture in Pixi can be shared between multiple DisplayObjects,
            // it's unable to know if the WebGLTexture in this Texture has been destroyed (GCed) and regenerated,
            // and therefore we always bind the texture at this moment no matter what
            this.internalModel.bindTexture(
                i,
                (texture.baseTexture as any)._glTextures[this.glContextID].texture,
            );

            // manually update the GC counter so they won't be GCed while using this model
            (texture.baseTexture as any).touched = renderer.textureGC.count;
        }

        // TODO: need fix here
        // const viewport = (renderer.framebuffer as any).viewport as Rectangle;
        // this.internalModel.viewport = [viewport.x, viewport.y, viewport.width, viewport.height];

        // update only if the time has changed, as the model will possibly be updated once but rendered multiple times
        if (this.deltaTime) {
            this.internalModel.update(this.deltaTime, this.elapsedTime);
            this.deltaTime = 0;
        }

        const internalTransform = tempMatrix
            // TODO: need fix here
            // .copyFrom(renderer.globalUniforms.uniformGroup.uniforms.projectionMatrix)
            .append(this.worldTransform);

        this.internalModel.updateTransform(internalTransform);
        this.internalModel.draw(renderer.gl);

        // reset WebGL state and texture bindings
        renderer.state.reset();
        renderer.texture.managedTextures.forEach((texture) => {
            renderer.texture.unbind(texture);
        })
        // same function? need tests
        // renderer.texture.reset();
    }

    /**
     * Destroys the model and all related resources. This takes the same options and also
     * behaves the same as `PIXI.Container#destroy`.
     * @param options - Options parameter. A boolean will act as if all options
     *  have been set to that value
     * @param [options.children=false] - if set to true, all the children will have their destroy
     *  method called as well. 'options' will be passed on to those calls.
     * @param [options.texture=false] - Only used for child Sprites if options.children is set to true
     *  Should it destroy the texture of the child sprite
     * @param [options.baseTexture=false] - Only used for child Sprites if options.children is set to true
     *  Should it destroy the base texture of the child sprite
     */
    destroy(options?: { children?: boolean; texture?: boolean; baseTexture?: boolean }): void {
        this.emit("destroy");

        if (options?.texture) {
            this.textures.forEach((texture) => texture.destroy(options.baseTexture));
        }

        this.automator.destroy();
        this.internalModel.destroy();

        super.destroy(options);
    }
}
