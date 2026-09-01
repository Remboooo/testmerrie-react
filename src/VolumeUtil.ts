// Hearing perceives loudness logarithmically, but <video>.volume (which is what
// the volume prop we hand OvenPlayer ultimately drives) is a linear amplitude
// multiplier. Feeding a linear 0-100 slider straight into it crams most of the
// audible change into the bottom of the range. This tapers slider position
// onto a dB scale instead — silence at 0, unity gain (0dB) at 100, MIN_DB of
// attenuation just above 0 — so equal slider steps feel like equal loudness
// steps. Output is 0-100, in the same units OvenPlayer's volume prop expects.
const MIN_DB = 50;

export function volumeToGain(percent: number): number {
    if (percent <= 0) {
        return 0;
    }
    if (percent >= 100) {
        return 100;
    }
    const db = MIN_DB * (percent / 100 - 1);
    return Math.pow(10, db / 20) * 100;
}
