//! `Celesta-mcp`: an MCP server on stdio that lets coding agents inspect,
//! render, and export Celesta videos and read the Celesta docs.

mod docs;
mod inspect;
mod server;
mod summary;

use std::process::ExitCode;

use rmcp::ServiceExt;

#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("Celesta MCP server: {error}");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let service = server::CelestaServer::new()?
        .serve(rmcp::transport::stdio())
        .await?;
    service.waiting().await?;
    Ok(())
}
