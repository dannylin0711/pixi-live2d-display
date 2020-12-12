import { MotionManager, MotionManagerOptions } from '@/cubism-common/MotionManager';
import { Cubism4ExpressionManager } from '@/cubism4/Cubism4ExpressionManager';
import { Cubism4ModelSettings } from '@/cubism4/Cubism4ModelSettings';
import { CubismModel } from '@cubism/model/cubismmodel';
import { ACubismMotion } from '@cubism/motion/acubismmotion';
import { CubismMotion } from '@cubism/motion/cubismmotion';
import { CubismMotionQueueManager } from '@cubism/motion/cubismmotionqueuemanager';
import Motion = CubismSpec.Motion;
import MotionJSON = CubismSpec.MotionJSON;

export interface Cubism4MotionGroups {
    Idle: any;
}

export class Cubism4MotionManager extends MotionManager<CubismModel, Cubism4ModelSettings, Cubism4ExpressionManager, CubismMotion, Motion, keyof Cubism4MotionGroups> {
    readonly groups = { idle: 'Idle' } as const;

    readonly motionDataType = 'json';

    readonly queueManager: CubismMotionQueueManager = new CubismMotionQueueManager();

    expressionManager?: Cubism4ExpressionManager;

    eyeBlinkIds: string[];
    lipSyncIds: string[];

    constructor(settings: Cubism4ModelSettings, options?: MotionManagerOptions) {
        super(settings, options);

        if (settings.expressions) {
            this.expressionManager = new Cubism4ExpressionManager(settings, options);
        }

        this.eyeBlinkIds = settings.getEyeBlinkParameters() || [];
        this.lipSyncIds = settings.getLipSyncParameters() || [];

        this.init();
    }

    isFinished(): boolean {
        return this.queueManager.isFinished();
    }

    protected _startMotion(motion: CubismMotion, onFinish?: (motion: CubismMotion) => void): number {
        motion.setFinishedMotionHandler(onFinish as (motion: ACubismMotion) => void);

        return this.queueManager.startMotion(motion, false, performance.now());
    }

    protected _stopAllMotions(): void {
        this.queueManager.stopAllMotions();
    }

    createMotion(data: JSONObject, definition: Motion): CubismMotion {
        const motion = CubismMotion.create(data as unknown as MotionJSON);

        if (definition.FadeInTime! >= 0) {
            motion.setFadeInTime(definition.FadeInTime!);
        }

        if (definition.FadeOutTime! >= 0) {
            motion.setFadeOutTime(definition.FadeOutTime!);
        }

        motion.setEffectIds(this.eyeBlinkIds, this.lipSyncIds);

        return motion;
    }

    getMotionFile(definition: Motion): string {
        return this.settings.resolvePath(definition.File);
    }

    protected getDefinitions(): Partial<Record<keyof Cubism4MotionGroups, Motion[]>> {
        return this.settings.motions ?? {};
    }

    protected getMotionName(definition: Motion): string {
        return definition.File;
    }

    protected getSoundFile(definition: Motion): string | undefined {
        return definition.Sound;
    }

    protected updateMotion(model: CubismModel, now: DOMHighResTimeStamp): boolean {
        return this.queueManager.doUpdateMotion(model, now);
    }
}