const API_BASE = "https://bam.bad-bit.net/api/v1"

export async function getStreams() {
    try {
        return (await fetch(API_BASE + "/streams")).json().then(j => j.streams);
    } catch (error) {
        console.log(error);
        return {};
    }
}