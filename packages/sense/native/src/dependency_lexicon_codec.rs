//! The bytes a lexicon keeps a value as: little-endian `u32`s, length-prefixed UTF-8, and a presence byte before
//! anything optional. One entry's reading is one blob of them, decoded only when a question reaches it, and a
//! record of the sites file is another.

// compass: variance-authority.reach.relations

use super::{Api, Identity, Name, Purpose, Readme, Skill, Source};

#[derive(Default)]
pub(super) struct Out {
    pub bytes: Vec<u8>,
}

impl Out {
    pub fn u8(&mut self, value: u8) { self.bytes.push(value); }

    pub fn u32(&mut self, value: u32) { self.bytes.extend_from_slice(&value.to_le_bytes()); }

    pub fn str(&mut self, value: &str) {
        self.u32(value.len() as u32);
        self.bytes.extend_from_slice(value.as_bytes());
    }

    pub fn opt<T>(&mut self, value: Option<T>, write: impl FnOnce(&mut Self, T)) {
        match value {
            None => self.u8(0),
            Some(value) => { self.u8(1); write(self, value); }
        }
    }

    pub fn list<T>(&mut self, values: &[T], mut write: impl FnMut(&mut Self, &T)) {
        self.u32(values.len() as u32);
        for value in values { write(self, value); }
    }
}

pub(super) struct In<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> In<'a> {
    pub fn new(bytes: &'a [u8]) -> Self { Self { bytes, at: 0 } }

    pub fn at(&self) -> usize { self.at }

    pub fn done(&self) -> bool { self.at == self.bytes.len() }

    fn take(&mut self, length: usize) -> Option<&'a [u8]> {
        let taken = self.bytes.get(self.at..self.at.checked_add(length)?)?;
        self.at += length;
        Some(taken)
    }

    pub fn u8(&mut self) -> Option<u8> { self.take(1).map(|bytes| bytes[0]) }

    pub fn u32(&mut self) -> Option<u32> {
        self.take(4).map(|bytes| u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
    }

    pub fn str(&mut self) -> Option<&'a str> {
        let length = self.u32()? as usize;
        std::str::from_utf8(self.take(length)?).ok()
    }

    pub fn string(&mut self) -> Option<String> { self.str().map(str::to_owned) }

    /// `Some(None)` is a value written absent; `None` is bytes that do not read.
    pub fn opt<T>(&mut self, read: impl FnOnce(&mut Self) -> Option<T>) -> Option<Option<T>> {
        match self.u8()? {
            0 => Some(None),
            1 => read(self).map(Some),
            _ => None,
        }
    }

    pub fn list<T>(&mut self, mut read: impl FnMut(&mut Self) -> Option<T>) -> Option<Vec<T>> {
        let count = self.u32()? as usize;
        // A count no byte could back is a torn or foreign blob, not a reason to reserve gigabytes.
        let mut values = Vec::with_capacity(count.min(self.bytes.len() - self.at));
        for _ in 0..count { values.push(read(self)?); }
        Some(values)
    }
}

fn identity(out: &mut Out, identity: &Identity) {
    out.str(&identity.name);
    out.str(&identity.version);
    out.str(&identity.manifest);
}

fn read_identity(input: &mut In) -> Option<Identity> {
    Some(Identity { name: input.string()?, version: input.string()?, manifest: input.string()? })
}

fn strings(out: &mut Out, values: &[String]) { out.list(values, |out, value| out.str(value)); }

fn read_strings(input: &mut In) -> Option<Vec<String>> { input.list(In::string) }

/// One entry's reading as the catalogue keeps it.
pub(super) fn api(api: &Api) -> Vec<u8> {
    let mut out = Out::default();
    out.opt(api.runtime.as_ref(), identity);
    out.opt(api.declarations.as_ref(), identity);
    out.opt(api.entrypoint.as_deref(), Out::str);
    out.opt(api.names.as_deref(), |out, names| out.list(names, |out, name| {
        out.str(&name.name);
        out.str(&name.kind);
        out.str(&name.at);
        out.u32(name.line);
        out.opt(name.signature.as_deref(), Out::str);
        out.opt(name.doc.as_deref(), Out::str);
    }));
    out.opt(api.sources.as_deref(), |out, sources| out.list(sources, |out, source| {
        out.str(&source.at);
        out.str(&source.digest);
    }));
    out.opt(api.unavailable.as_deref(), Out::str);
    out.opt(api.readme.as_ref(), |out, readme| {
        out.str(&readme.at);
        out.opt(readme.lines, Out::u32);
        out.opt(readme.unreadable.as_deref(), Out::str);
    });
    out.opt(api.purpose.as_ref(), |out, purpose| {
        out.opt(purpose.description.as_deref(), Out::str);
        strings(out, &purpose.keywords);
        strings(out, &purpose.headings);
        strings(out, &purpose.said);
        strings(out, &purpose.named);
    });
    out.opt(api.skills.as_deref(), |out, skills| out.list(skills, |out, skill| {
        out.str(&skill.name);
        out.str(&skill.at);
        out.opt(skill.description.as_deref(), Out::str);
        out.opt(skill.unreadable.as_deref(), Out::str);
    }));
    out.bytes
}

/// The reading `api` wrote, or `None` for bytes it did not write.
pub(super) fn read_api(bytes: &[u8]) -> Option<Api> {
    let mut input = In::new(bytes);
    let input = &mut input;
    let api = Api {
        runtime: input.opt(read_identity)?,
        declarations: input.opt(read_identity)?,
        entrypoint: input.opt(In::string)?,
        names: input.opt(|input| input.list(|input| Some(Name {
            name: input.string()?, kind: input.string()?, at: input.string()?, line: input.u32()?,
            signature: input.opt(In::string)?, doc: input.opt(In::string)?,
        })))?,
        sources: input.opt(|input| input.list(|input| Some(Source { at: input.string()?, digest: input.string()? })))?,
        unavailable: input.opt(In::string)?,
        readme: input.opt(|input| Some(Readme { at: input.string()?, lines: input.opt(In::u32)?, unreadable: input.opt(In::string)? }))?,
        purpose: input.opt(|input| Some(Purpose {
            description: input.opt(In::string)?, keywords: read_strings(input)?, headings: read_strings(input)?,
            said: read_strings(input)?, named: read_strings(input)?,
        }))?,
        skills: input.opt(|input| input.list(|input| Some(Skill {
            name: input.string()?, at: input.string()?, description: input.opt(In::string)?, unreadable: input.opt(In::string)?,
        })))?,
    };
    input.done().then_some(api)
}
